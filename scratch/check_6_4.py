import os
import json
from psycopg2 import connect
from dotenv import load_dotenv

load_dotenv()
conn = connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

cur.execute("SELECT id, data FROM visit_records")
for row in cur.fetchall():
    data = row[1]
    checks = data.get("categoryChecks", {})
    if "6-4" in checks:
        print(f"Record {row[0]}: categoryChecks = {checks}")

