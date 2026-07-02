import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
uri = os.getenv("MONGO_URI")

async def test_conn():
    try:
        print(f"嘗試連線至 MongoDB...")
        # 降低 Timeout 時間，避免等待太久
        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
        # 嘗試取得伺服器資訊以觸發真實連線
        await client.server_info()
        print("連線成功！資料庫已準備就緒！")
    except Exception as e:
        print(f"連線失敗：{e}")

if __name__ == "__main__":
    asyncio.run(test_conn())
