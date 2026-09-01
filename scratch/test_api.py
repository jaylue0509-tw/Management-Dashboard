import requests
import json

payload = {
  "storeName": "測試門市",
  "areaManagerName": "系統測試員",
  "region": "中投區",
  "auditMode": "C",
  "overallRating": "需重點輔導",
  "expectedStayMinutes": 60,
  "abnormalFlag": True,
  "categoryChecks": {
    "1-1": "合格", "1-2": "缺失",
    "2-1": "合格",
    "3-1": "缺失",
    "4-1": "合格",
    "5-1": "缺失",
    "6-1": "合格"
  }
}

res = requests.post("https://management-dashboard-rust.vercel.app/api/visit-records", json=payload)
print(res.status_code)
print(res.text)
