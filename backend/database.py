import os
import logging
from contextlib import contextmanager
import psycopg2
from psycopg2 import pool
from psycopg2.extras import Json
from backend.security import pwd_context

logger = logging.getLogger("dashboard-api")

# === 全域常數設定 ===
ITEM_NAMES = {
    '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
    '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
    '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
    '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
    '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
    '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
}

POSTGRES_URL = os.getenv("POSTGRES_URL")

# 初始化連線池 (Connection Pool)
# 最小連線數 1，最大連線數 5，避免耗盡 Vercel Postgres 的同時連線上限
db_pool = None
if POSTGRES_URL:
    try:
        db_pool = pool.SimpleConnectionPool(1, 5, POSTGRES_URL, sslmode='require')
    except Exception as e:
        logger.error("連線池初始化失敗: %s", e)

@contextmanager
def get_db_connection():
    if not POSTGRES_URL or not db_pool:
        raise Exception("POSTGRES_URL is not set or pool not initialized")
    
    # 從連線池中獲取一條可用連線
    conn = db_pool.getconn()
    # NOTE: Neon / Vercel Postgres 會主動關閉閒置連線，取得已斷線的連線時直接丟棄並換一條新的
    if conn.closed:
        db_pool.putconn(conn, close=True)
        conn = db_pool.getconn()
    try:
        yield conn
    finally:
        # NOTE: 歸還前回滾任何未提交 / 已中斷的交易，避免一次 SQL 錯誤讓這條連線卡在
        # "current transaction is aborted" 狀態，進而影響下一位使用者的請求
        if conn.closed:
            db_pool.putconn(conn, close=True)
        else:
            try:
                conn.rollback()
                db_pool.putconn(conn)
            except psycopg2.Error:
                db_pool.putconn(conn, close=True)

def init_db():
    """
    初始化資料庫表結構與索引
    """
    if not POSTGRES_URL:
        return
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # 儲存全域資料的表 (例如門市主管清單)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS store (
                        id VARCHAR(50) PRIMARY KEY,
                        data JSONB
                    );
                """)
                # 儲存巡店紀錄的表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS visit_records (
                        id VARCHAR(50) PRIMARY KEY,
                        region VARCHAR(50),
                        created_at TIMESTAMP,
                        data JSONB
                    );
                """)
                # 建立待改善事項 (Action Items) 表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS action_items (
                        id VARCHAR(50) PRIMARY KEY,
                        store_name VARCHAR(100),
                        created_at TIMESTAMP,
                        data JSONB
                    );
                """)
                # 加入索引優化查詢效能
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_created_at ON visit_records (created_at DESC);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_region ON visit_records (region);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_data_gin ON visit_records USING GIN (data);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_action_items_store_name ON action_items (store_name);")
                
                # 巡店照片獨立存放
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS photos (
                        id VARCHAR(50) PRIMARY KEY,
                        record_id VARCHAR(50),
                        mime_type VARCHAR(50) NOT NULL,
                        content BYTEA NOT NULL,
                        created_at TIMESTAMP
                    );
                """)
                # 建立使用者表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        username VARCHAR(50) PRIMARY KEY,
                        password_hash VARCHAR(255) NOT NULL,
                        role VARCHAR(20) NOT NULL,
                        name VARCHAR(50) NOT NULL,
                        assigned_stores JSONB,
                        plain_password VARCHAR(255),
                        must_change_password BOOLEAN DEFAULT TRUE
                    );
                """)
                cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT TRUE;")
                cur.execute("UPDATE users SET must_change_password = TRUE WHERE must_change_password IS NULL AND role = 'manager';")
                cur.execute("UPDATE users SET must_change_password = FALSE WHERE username = 'admin';")
                cur.execute("DELETE FROM visit_records WHERE id = '0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c';")
                cur.execute("DELETE FROM action_items WHERE id = '86ed0b29-dc30-4825-808d-9a58d6c5e38f';")

                # 建立異動紀錄表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS audit_logs (
                        id VARCHAR(50) PRIMARY KEY,
                        action VARCHAR(50),
                        target_user VARCHAR(50),
                        changed_by VARCHAR(50),
                        before_data JSONB,
                        after_data JSONB,
                        created_at TIMESTAMP
                    );
                """)
            conn.commit()

            # 初始化預設帳號與 2026 組織同步
            init_default_users(conn)
            sync_region_reorg_2026(conn)

    except Exception as e:
        logger.error("DB Init Error: %s", e)

def init_default_users(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            admin_hash = pwd_context.hash("admin1234")
            cur.execute("""
                INSERT INTO users (username, password_hash, role, name, assigned_stores, must_change_password)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, ("admin", admin_hash, "admin", "總部管理員", Json([]), False))
            conn.commit()

            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                managers = row[0]
                mgr_map = {}
                for m in managers:
                    name = m.get("areaManagerName", "").strip()
                    store = m.get("storeName", "").strip()
                    if name and store:
                        if name not in mgr_map:
                            mgr_map[name] = []
                        mgr_map[name].append(store)

                mgr_hash = pwd_context.hash("admin1234")
                for name, stores in mgr_map.items():
                    cur.execute("""
                        INSERT INTO users (username, password_hash, role, name, assigned_stores, plain_password, must_change_password)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (name, mgr_hash, "manager", name, Json(stores), "admin1234", True))
            conn.commit()

def sync_region_reorg_2026(conn):
    """
    同步 2026 最新區域與門市組織整併
    """
    jianan_stores = [
        "新營民生店", "麻豆興中店", "佳里新生店", "善化光復店", "新市中正店",
        "嘉義北港店", "嘉義友愛店", "嘉義吳鳳南店", "嘉義朴子店",
        "安南海佃店", "台南永康店", "永康永大店", "關廟南雄店",
        "台南中華東店", "台南西門店", "仁德中山店", "安平建平店", "歸仁中山店"
    ]
    jianan_set = set(jianan_stores)
    gaoping_moved = {"大寮鳳林店", "高雄林園東店", "高雄林園店"}

    with conn.cursor() as cur:
        cur.execute("SELECT data FROM store WHERE id = 'managers'")
        row = cur.fetchone()
        if not row or not isinstance(row[0], list):
            return

        managers = row[0]
        changed = False
        seen_stores = set()
        updated_managers = []
        sample_dept = ""
        sample_director = ""

        for m in managers:
            if m.get("region") in ("嘉南區", "台南區") and m.get("department"):
                sample_dept = m.get("department", "")
                sample_director = m.get("directorName", "")
                if m.get("region") == "嘉南區":
                    break

        for m in managers:
            s_name = str(m.get("storeName") or "").strip()
            if not s_name:
                continue
            if s_name == "高雄林園店":
                s_name = "高雄林園東店"
                m["storeName"] = s_name
                changed = True

            if m.get("region") in ("彰雲嘉區", "彰雲區", "台南區", "嘉南區") and not sample_dept:
                sample_dept = m.get("department", "")
                sample_director = m.get("directorName", "")

            if s_name in jianan_set:
                if (
                    m.get("region") != "嘉南區"
                    or m.get("areaManagerName") != "葉信宏"
                    or m.get("deputyManagerName") != "李景傑"
                    or (sample_dept and m.get("department") != sample_dept)
                ):
                    m["region"] = "嘉南區"
                    m["areaManagerName"] = "葉信宏"
                    m["deputyManagerName"] = "李景傑"
                    if sample_dept:
                        m["department"] = sample_dept
                    if sample_director:
                        m["directorName"] = sample_director
                    changed = True
            elif m.get("region") in ("嘉南區", "台南區") or m.get("areaManagerName") in ("葉信宏", "李景傑"):
                changed = True
                continue
            elif s_name in gaoping_moved:
                if m.get("region") != "高屏區" or m.get("areaManagerName") != "鍾宜玲":
                    m["region"] = "高屏區"
                    m["areaManagerName"] = "鍾宜玲"
                    changed = True
            elif m.get("region") in ("彰雲嘉區", "彰嘉雲區"):
                m["region"] = "彰雲區"
                changed = True

            if s_name not in seen_stores:
                seen_stores.add(s_name)
                updated_managers.append(m)
            else:
                changed = True

        for js in jianan_stores:
            if js not in seen_stores:
                updated_managers.append({
                    "department": sample_dept,
                    "directorName": sample_director,
                    "region": "嘉南區",
                    "areaManagerName": "葉信宏",
                    "deputyManagerName": "李景傑",
                    "storeName": js,
                    "beautyLeader": "",
                    "todayVisitCount": 0,
                    "assignedStoreCount": 0,
                    "hasAbnormal": False,
                    "visitStatus": "尚未回填"
                })
                seen_stores.add(js)
                changed = True

        if changed:
            cur.execute("UPDATE store SET data = %s WHERE id = 'managers'", (Json(updated_managers),))

        target_mgrs = {"葉信宏", "林晟豐", "李景傑", "涂綺恬", "鍾宜玲"}
        mgr_stores_map = {name: [] for name in target_mgrs}
        for m in updated_managers:
            mgr_name = str(m.get("areaManagerName") or "").strip()
            s_name = str(m.get("storeName") or "").strip()
            if mgr_name in mgr_stores_map and s_name:
                mgr_stores_map[mgr_name].append(s_name)

        mgr_stores_map["葉信宏"] = list(jianan_stores)
        mgr_stores_map["李景傑"] = list(jianan_stores)

        for mgr_name, stores_list in mgr_stores_map.items():
            cur.execute("SELECT assigned_stores FROM users WHERE username = %s", (mgr_name,))
            u_row = cur.fetchone()
            if not u_row:
                mgr_hash = pwd_context.hash("admin1234")
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, name, assigned_stores, plain_password, must_change_password)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (mgr_name, mgr_hash, "manager", mgr_name, Json(stores_list), "admin1234", True))
            else:
                current_stores = u_row[0] or []
                if current_stores != stores_list:
                    cur.execute(
                        "UPDATE users SET assigned_stores = %s, name = %s WHERE username = %s",
                        (Json(stores_list), mgr_name, mgr_name)
                    )

        cur.execute(
            """
            UPDATE visit_records
            SET region = '嘉南區',
                data = jsonb_set(data, '{region}', '"嘉南區"', true)
            WHERE region = '台南區'
               OR data->>'region' = '台南區'
               OR data->>'storeName' = ANY(%s)
            """,
            (jianan_stores,)
        )
    conn.commit()

