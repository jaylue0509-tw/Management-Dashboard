import os
from dotenv import load_dotenv
import psycopg2

load_dotenv('.env.production.local')

import re

POSTGRES_URL = os.getenv("POSTGRES_URL")
if POSTGRES_URL:
    match = re.search(r'(postgres://[^\s\"\']+)', POSTGRES_URL)
    if match:
        POSTGRES_URL = match.group(1)

if not POSTGRES_URL:
    print("POSTGRES_URL is not set.")
    exit(1)

try:
    conn = psycopg2.connect(POSTGRES_URL, sslmode='require')
    cur = conn.cursor()
    
    print("Adding indexes to visit_records...")
    # Add index for ordering and filtering by date
    cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_created_at ON visit_records (created_at DESC);")
    
    # Add index for region filtering (if region is frequently queried, though it's inside JSON or as a column)
    # The schema has: region VARCHAR(50)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_region ON visit_records (region);")
    
    # Add GIN index for JSONB queries just in case we need fast text search or field filtering later
    cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_data_gin ON visit_records USING GIN (data);")
    
    conn.commit()
    print("Indexes successfully created!")
    
except Exception as e:
    print(f"Error: {e}")
finally:
    if 'cur' in locals():
        cur.close()
    if 'conn' in locals():
        conn.close()
