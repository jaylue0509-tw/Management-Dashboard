import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
uri = os.getenv("MONGO_URI")

async def check_mongo():
    try:
        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
        databases = await client.list_database_names()
        print("Databases:", databases)
        
        for db_name in databases:
            if db_name in ['admin', 'local']: continue
            db = client[db_name]
            collections = await db.list_collection_names()
            for coll_name in collections:
                count = await db[coll_name].count_documents({})
                print(f"DB: {db_name}, Collection {coll_name} has {count} documents.")
                if count > 0:
                    sample = await db[coll_name].find_one()
                    print(f"Sample from {db_name}.{coll_name}: {sample}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_mongo())
