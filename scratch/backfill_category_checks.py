import os
from dotenv import load_dotenv
import psycopg2
import json
import random

load_dotenv('.env')

conn = psycopg2.connect(os.environ['POSTGRES_URL'])
cur = conn.cursor()

# Get all records
cur.execute("SELECT id, data FROM visit_records")
records = cur.fetchall()

updated = 0
for rid, data in records:
    if 'categoryChecks' not in data:
        is_abnormal = data.get('abnormalFlag', False)
        
        # Generate some dummy data
        checks = {}
        for mod in range(1, 7):
            for item in range(1, 3):
                key = f"{mod}-{item}"
                # If abnormal, give a 20% chance of '缺失', otherwise '合格'
                if is_abnormal and random.random() < 0.2:
                    checks[key] = "缺失"
                else:
                    checks[key] = "合格"
                    
        # If it was abnormal but no '缺失' generated, force one
        if is_abnormal and '缺失' not in checks.values():
            checks[f"{random.randint(1,6)}-1"] = "缺失"
            
        data['categoryChecks'] = checks
        
        cur.execute("UPDATE visit_records SET data = %s WHERE id = %s", (json.dumps(data), rid))
        updated += 1

conn.commit()
print(f"Successfully backfilled categoryChecks for {updated} records.")
