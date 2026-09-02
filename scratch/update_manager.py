import urllib.request
import json

def update():
    # 1. Login as admin
    data = json.dumps({'username': 'admin', 'password': 'admin1234'}).encode('utf-8')
    req = urllib.request.Request('https://management-dashboard-rust.vercel.app/api/auth/login', data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as f:
        token = json.loads(f.read().decode('utf-8'))['token']
    
    # Stores for 陳育廷
    stores = [
      "新莊旗艦店", "新莊中正店", "新北八里店", "土城中華店",
      "永和得和店", "三重中正北店", "三重三和店", "板橋雨農店"
    ]
    
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    
    # 2. Create 曾志偉
    zeng_data = json.dumps({
        'username': '曾志偉',
        'password': '1234',
        'name': '曾志偉',
        'assigned_stores': stores
    }).encode('utf-8')
    req2 = urllib.request.Request('https://management-dashboard-rust.vercel.app/api/admin/users', data=zeng_data, headers=headers)
    with urllib.request.urlopen(req2) as f2:
        print("Created 曾志偉:", f2.read().decode('utf-8'))
        
    # 3. Clear 陳育廷's stores so he is inactive
    chen_data = json.dumps({
        'username': '陳育廷',
        'name': '陳育廷',
        'assigned_stores': []
    }).encode('utf-8')
    req3 = urllib.request.Request('https://management-dashboard-rust.vercel.app/api/admin/users', data=chen_data, headers=headers)
    with urllib.request.urlopen(req3) as f3:
        print("Cleared 陳育廷:", f3.read().decode('utf-8'))

if __name__ == '__main__':
    update()
