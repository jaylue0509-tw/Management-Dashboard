import os
import jwt
from fastapi import HTTPException, Header, Depends
from typing import Optional
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET = os.getenv("JWT_SECRET", "management-dashboard-secret-2026")
JWT_ALGORITHM = "HS256"

def get_current_user(authorization: str = Header(None)) -> dict:
    """
    解析 Bearer Token，獲取當前使用者身分資訊
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_optional_user(authorization: str = Header(None)) -> Optional[dict]:
    """
    可選的身分解析：有帶有效 token 時回傳使用者資訊，否則回傳 None (相容舊版前端與外部匯入腳本)
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return jwt.decode(authorization.split(" ")[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    僅允許 admin 呼叫的端點依賴
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return user

