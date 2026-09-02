import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()

POSTGRES_URL = os.getenv("POSTGRES_URL")

def main():
    if not POSTGRES_URL:
        print("錯誤：未設定 POSTGRES_URL 環境變數")
        return

    conn = None
    cur = None
    try:
        conn = psycopg2.connect(POSTGRES_URL, sslmode='require')
        cur = conn.cursor()
        print("成功連線至 Vercel Postgres！\n")
        
        # 查詢最近的 3 筆巡店紀錄
        cur.execute("SELECT created_at, data FROM visit_records ORDER BY created_at DESC LIMIT 3")
        rows = cur.fetchall()
        
        if not rows:
            print("目前資料庫中沒有任何巡店紀錄。")
        else:
            print(f"找到 {len(rows)} 筆最新紀錄：\n" + "="*40)
            for idx, row in enumerate(rows):
                created_at, data = row
                area_manager = data.get("areaManagerName", "未知")
                store = data.get("storeName", "未知")
                photos = data.get("photoPairs", [])
                
                print(f"[{idx+1}] 時間: {created_at}")
                print(f"    主管: {area_manager}")
                print(f"    門市: {store}")
                print(f"    照片: {len(photos)} 對")
                if photos:
                    print(f"    網址: {photos}")
                print("-" * 40)
                
    except psycopg2.OperationalError as e:
        print(f"資料庫連線失敗 (OperationalError): {e}")
    except Exception as e:
        print(f"查詢發生未預期錯誤: {e}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
            print("資料庫連線已安全關閉。")

if __name__ == "__main__":
    main()
