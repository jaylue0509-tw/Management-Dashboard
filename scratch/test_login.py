import urllib.request
import json

def test():
    try:
        # 1. Login to get token
        data = json.dumps({'username': '林晟豐', 'password': '1234'}).encode('utf-8')
        req = urllib.request.Request('https://management-dashboard-rust.vercel.app/api/auth/login', data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as f:
            res = json.loads(f.read().decode('utf-8'))
            print("Login success! Token:", res.get('token')[:10], "...")
            token = res['token']
            
            # 2. Get users
            req2 = urllib.request.Request('https://management-dashboard-rust.vercel.app/api/admin/users', headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(req2) as f2:
                users = json.loads(f2.read().decode('utf-8'))
                with open('scratch/users.json', 'w', encoding='utf-8') as f:
                    json.dump(users, f, ensure_ascii=False, indent=2)
                print("Users dumped to scratch/users.json")
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code} {e.reason}")
        print(e.read().decode('utf-8'))
    except Exception as e:
        print("Error:", e)

if __name__ == '__main__':
    test()
