import os
import sys

# 確保 Python 能夠找到 backend 目錄下的檔案
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# 匯入原本寫好的 FastAPI app，讓 Vercel Serverless Function 能夠執行它
from backend.main import app
