"""營業處與區域、處長的現行對應。"""

BUSINESS_DEPT_1_REGIONS = {"新北區", "北桃區", "竹苗區", "宜花區", "嘉南區", "台南區"}
BUSINESS_DEPT_2_REGIONS = {"中投區", "彰雲區", "彰雲嘉區", "彰嘉雲區", "高雄區", "高屏區"}

BUSINESS_DEPARTMENT_DIRECTORS = {
    "營業一處": "簡楷潔",
    "營業二處": "蔡嘉峯",
}


def business_department_for_region(region: str) -> str:
    """依區域決定營業處別，避免沿用匯入檔中的過時處別。"""
    if region in BUSINESS_DEPT_1_REGIONS:
        return "營業一處"
    if region in BUSINESS_DEPT_2_REGIONS:
        return "營業二處"
    return ""


def business_director_for_department(department: str) -> str:
    """依營業處別回傳現行對應處長姓名。"""
    return BUSINESS_DEPARTMENT_DIRECTORS.get((department or "").strip(), "")
