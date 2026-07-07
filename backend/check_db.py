import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()

POSTGRES_URL = os.getenv("POSTGRES_URL")

try:
    conn = psycopg2.connect(POSTGRES_URL, sslmode='require')
    cur = conn.cursor()
    print("成功連線至 Vercel Postgres！")
    
    # 查詢最近的 3 筆巡店紀錄
    cur.execute("SELECT created_at, data FROM visit_records ORDER BY created_at DESC LIMIT 3")
    rows = cur.fetchall()
    
    if not rows:
        print("目前資料庫中沒有任何巡店紀錄。")
    else:
        print(f"找到 {len(rows)} 筆最新紀錄：\n")
        for idx, row in enumerate(rows):
            created_at, data = row
            area_manager = data.get("areaManagerName", "未知")
            store = data.get("storeName", "未知")
            photos = data.get("photoPairs", [])
            print(f"[{idx+1}] 時間: {created_at}")
            print(f"    主管: {area_manager}")
            print(f"    門市: {store}")
            print(f"    包含照片對數: {len(photos)}")
            if len(photos) > 0:
                print(f"    照片網址庫: {photos}")
            print("-" * 40)
            
    cur.close()
    conn.close()
except Exception as e:
    print(f"連線或查詢失敗: {e}")
