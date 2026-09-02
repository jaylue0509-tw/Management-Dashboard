import os
from dotenv import load_dotenv
from passlib.context import CryptContext
import psycopg2

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
POSTGRES_URL = os.getenv("POSTGRES_URL")

def reset_passwords():
    if not POSTGRES_URL:
        print("No POSTGRES_URL")
        return
        
    try:
        conn = psycopg2.connect(POSTGRES_URL)
        cur = conn.cursor()
        
        # update all managers to '1234'
        new_hash = pwd_context.hash("1234")
        cur.execute("UPDATE users SET password_hash = %s WHERE role = 'manager'", (new_hash,))
        
        updated = cur.rowcount
        conn.commit()
        print(f"Updated {updated} managers to password '1234'")
        
        cur.close()
        conn.close()
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    reset_passwords()
