from datetime import datetime
from typing import List, Optional, Dict
from pydantic import BaseModel, Field

class Manager(BaseModel):
    department: str
    directorName: str
    region: str
    areaManagerName: str
    deputyManagerName: str
    storeName: str
    beautyLeader: str
    todayVisitCount: int = 0
    assignedStoreCount: int = 0
    hasAbnormal: bool = False
    visitStatus: str = "尚未回填"

class PhotoPair(BaseModel):
    beforeUrl: str
    afterUrl: str

class VisitRecord(BaseModel):
    recordId: str
    areaManagerName: str
    jobTitle: str = "區主管"
    actionType: str = "巡店"
    storeName: str
    region: str
    timeAgoMinutes: int = 0
    expectedStayMinutes: int = 0
    tags: List[str] = []
    immediateImprovement: str = ""
    highlightDescription: Optional[str] = ""
    abnormalFlag: bool = False
    photoPairs: List[PhotoPair] = []
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    # AuditApp 擴充欄位
    auditMode: Optional[str] = ""
    selectedTopics: Optional[List[int]] = []
    coreChecks: Optional[Dict[str, str]] = {}
    categoryChecks: Optional[Dict[str, str]] = {}
    categoryRemarks: Optional[Dict[str, str]] = {}
    pdcaResults: Optional[Dict[str, str]] = {}
    overallRating: Optional[str] = ""

class LoginRequest(BaseModel):
    username: str
    password: str

class PasswordChangeRequest(BaseModel):
    oldPassword: str
    newPassword: str

class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str
    name: str
    assigned_stores: List[str] = []

class ResolveStoreRequest(BaseModel):
    storeName: str
    resolvedBy: str = "區主管"

class UpdateVisitRecordRequest(BaseModel):
    actionType: Optional[str] = None
    storeName: Optional[str] = None
    highlightDescription: Optional[str] = None
    immediateImprovement: Optional[str] = None
    expectedStayMinutes: Optional[int] = None
    createdAt: Optional[datetime] = None

class ActionItemCreate(BaseModel):
    storeName: str
    topicId: int
    itemId: str
    desc: str
    assignee: str
    dueDate: str
    status: str = "待處理"
    sourceRecordId: Optional[str] = None

class ActionItemUpdate(BaseModel):
    status: Optional[str] = None
    resolvedAt: Optional[str] = None
    resolvedBy: Optional[str] = None
    note: Optional[str] = None

