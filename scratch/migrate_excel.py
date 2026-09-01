import os
import uuid
import json
import psycopg2
from psycopg2.extras import Json
import pandas as pd
from datetime import datetime

# Load env variables from .env.production
from dotenv import load_dotenv
load_dotenv(r"C:\Users\Jay\Management Dashboard\.env.production")

DATABASE_URL = os.getenv("POSTGRES_URL")
if DATABASE_URL:
    DATABASE_URL = DATABASE_URL.strip('"').strip("'")


file_path = r"C:\Users\Jay\Management Dashboard\DATA\東寵門市 巡店紀錄表－回覆資料.xlsx"
df = pd.read_excel(file_path)

conn = psycopg2.connect(DATABASE_URL)
cursor = conn.cursor()

inserted = 0

for idx, row in df.iterrows():
    record_id = str(uuid.uuid4())
    region = str(row.get("處／區", ""))
    
    raw_time = row.get("Timestamp")
    if pd.isna(raw_time):
        created_at = datetime.now()
    else:
        created_at = pd.to_datetime(raw_time)

    issue_count = 0
    for val in row.values:
        if isinstance(val, str) and val == "缺失待追蹤":
            issue_count += 1
            
    if issue_count == 0:
        overall_rating = "良好"
    elif issue_count <= 2:
        overall_rating = "需追蹤"
    else:
        overall_rating = "需重點輔導"
    
    def map_val(val):
        if pd.isna(val): return "N/A"
        val = str(val)
        if "符合" in val: return "合格"
        if "不適用" in val: return "N/A"
        if "缺失待追蹤" in val: return "缺失"
        if "缺失已立即改善" in val: return "待改善"
        return "N/A"

    data = {
        "recordId": record_id,
        "storeName": str(row.get("門市", "")),
        "areaManagerName": str(row.get("巡店人員姓名", "")),
        "auditMode": "C", 
        "overallRating": overall_rating,
        "expectedStayMinutes": 120, 
        "categoryChecks": {
            "1-1": map_val(row.get("一、排面陳列－檢查結果 [＊1. 檢查排面商品是否排列整齊，是否缺貨空洞／過期商品。]")),
            "1-2": map_val(row.get("一、排面陳列－檢查結果 [＊2. 檢查排面商品價卡、促銷 POP、輔銷物是否正確擺放。]")),
            "1-3": map_val(row.get("一、排面陳列－檢查結果 [3. 檢查排面是否有先進先出原則。]")),
            "1-4": map_val(row.get("一、排面陳列－檢查結果 [4. 觀察排面商品陳列邏輯，是否有調整與改善空間。]")),
            
            "2-1": map_val(row.get("二、檔期促銷商品－檢查結果 [＊1. 檢查 DM 促銷商品庫存與陳列位置。]")),
            "2-2": map_val(row.get("二、檔期促銷商品－檢查結果 [＊2. 檢查 DM 促銷商品促銷價卡、POP、輔銷物是否執行。]")),
            
            "3-1": map_val(row.get("三、檔期指定陳列－檢查結果 [＊1. 檢查大位區商品／POP／輔銷物是否依營運公告執行。]")),
            "3-2": map_val(row.get("三、檔期指定陳列－檢查結果 [＊2. 檢查端架區商品／POP／輔銷物是否依營運公告執行。]")),
            "3-3": map_val(row.get("三、檔期指定陳列－檢查結果 [＊3. 檢查紙架商品／POP／輔銷物是否依營運公告執行。]")),
            "3-4": map_val(row.get("三、檔期指定陳列－檢查結果 [＊4. 檢查收銀區商品／POP／輔銷物是否依營運公告執行。]")),
            "3-5": map_val(row.get("三、檔期指定陳列－檢查結果 [＊5. 檢查貨架排面是否依營運公告之指定陳列執行。]")),
            "3-6": map_val(row.get("三、檔期指定陳列－檢查結果 [＊6. 檢查專案陳列，例如智能桌，是否依指定方式呈現與維護。]")),
            
            "4-1": map_val(row.get("四、檔期輔銷物－檢查結果 [＊1. 檢查門市布條是否執行。]")),
            "4-2": map_val(row.get("四、檔期輔銷物－檢查結果 [＊2. 檢查門市海報是否張貼正確。]")),
            "4-3": map_val(row.get("四、檔期輔銷物－檢查結果 [＊3. 檢查門市 DM 擺放是否正確，例如櫃台、購物籃、購物車。]")),
            "4-4": map_val(row.get("四、檔期輔銷物－檢查結果 [＊4. 檢查金銀卡插卡是否擺放。]")),
            
            "5-1": map_val(row.get("五、店務檢視－檢查結果 [＊1. 檢查外送機台是否開啟連線。]")),
            "5-2": map_val(row.get("五、店務檢視－檢查結果 [＊2. 檢查門店環境整潔、人員服務或其他購物體驗感。]")),
            "5-3": map_val(row.get("五、店務檢視－檢查結果 [＊3. 檢查走道是否堆疊貨品或雜物阻礙顧客動線。]")),
            "5-4": map_val(row.get("五、店務檢視－檢查結果 [＊4. 檢查倉庫是否整倉、庫存狀況、過期／即期品未處理。]")),
            "5-5": map_val(row.get("五、店務檢視－檢查結果 [＊5. 檢查魔鏡／電視音量是否適中。]")),
            "5-6": map_val(row.get("五、店務檢視－檢查結果 [6. 觀察門店空間運用是否有閒置、浪費狀況。]")),
            
            "6-1": map_val(row.get("六、顧客服務－檢查結果 [＊1. 觀察同仁針對顧客進店時是否有迎賓語或主動打招呼。]")),
            "6-2": map_val(row.get("六、顧客服務－檢查結果 [2. 觀察同仁與顧客互動時是否表現得有禮貌、耐心。]")),
            "6-3": map_val(row.get("六、顧客服務－檢查結果 [3. 觀察是否有顧客明顯等待過久未被協助的情況。]")),
            "6-4": map_val(row.get("六、顧客服務－檢查結果 [4. 觀察同仁面銷專業度與積極性。]")),
            "6-5": map_val(row.get("六、顧客服務－檢查結果 [5. 觀察顧客進店後的顧客滿意度。]")),
            "6-6": map_val(row.get("六、顧客服務－檢查結果 [＊6. 觀察同仁是否有危害寵物或傷害公司形象之作為。]"))
        }
    }
    
    issues_text = []
    if not pd.isna(row.get("一、排面陳列－紀錄缺失項目")): issues_text.append(str(row.get("一、排面陳列－紀錄缺失項目")))
    if not pd.isna(row.get("二、檔期促銷商品－紀錄缺失項目")): issues_text.append(str(row.get("二、檔期促銷商品－紀錄缺失項目")))
    if not pd.isna(row.get("三、檔期指定陳列－紀錄缺失項目")): issues_text.append(str(row.get("三、檔期指定陳列－紀錄缺失項目")))
    if not pd.isna(row.get("四、檔期輔銷物－紀錄缺失項目")): issues_text.append(str(row.get("四、檔期輔銷物－紀錄缺失項目")))
    if not pd.isna(row.get("五、店務檢視－紀錄缺失項目")): issues_text.append(str(row.get("五、店務檢視－紀錄缺失項目")))
    if not pd.isna(row.get("六、顧客服務－紀錄缺失項目")): issues_text.append(str(row.get("六、顧客服務－紀錄缺失項目")))
    if not pd.isna(row.get("巡店人員總結與後續追蹤事項")): issues_text.append("總結與追蹤: " + str(row.get("巡店人員總結與後續追蹤事項")))
    
    data["notes"] = "\n".join(issues_text)

    before_url = str(row.get("[ 排面陳列 ] 改善前 (Before) 照片"))
    after_url = str(row.get("[ 排面陳列 ] 改善後 (After) 照片"))
    
    data["photos"] = []
    if not pd.isna(row.get("[ 排面陳列 ] 改善前 (Before) 照片")) and before_url.startswith("http"):
        data["photos"].append({"url": before_url, "description": "改善前 (Before)"})
    if not pd.isna(row.get("[ 排面陳列 ] 改善後 (After) 照片")) and after_url.startswith("http"):
        data["photos"].append({"url": after_url, "description": "改善後 (After)"})
        
    try:
        cursor.execute(
            "INSERT INTO visit_records (id, region, created_at, data) VALUES (%s, %s, %s, %s)",
            (record_id, region, created_at, Json(data))
        )
        inserted += 1
    except Exception as e:
        print(f"Error inserting row {idx}: {e}")
        
conn.commit()
cursor.close()
conn.close()

print(f"Successfully migrated {inserted} records to Postgres!")
