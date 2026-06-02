"""API Gateway 공개 엔드포인트 라이브 상태 점검(읽기 전용).

PowerShell 5.1 의 Invoke-WebRequest 는 기본 TLS 설정/엔진 문제로 빈 에러를 내므로,
파이썬 urllib(적절한 TLS)로 게이트웨이 경로별 응답 코드를 찍는다.

실행(apps/api):  .venv\\Scripts\\python.exe scripts\\_check_gateway.py
"""
import json
import urllib.error
import urllib.request

BASE = "https://induspot-gateway-9t4vof78.uc.gateway.dev"
CHECKS = [
    ("GET", "/health", None),
    ("POST", "/predict", {"facility_type": "cafeteria", "hour": 12, "day_of_week": 2}),
    ("GET", "/api/v1/forecast/heatmap?hours=6", None),
    ("GET", "/api/v1/forecast/congestion?facility_id=1", None),
]

for method, path, body in CHECKS:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            txt = r.read(160).decode("utf-8", "ignore").replace("\n", " ")
            print(f"{method} {path} -> {r.status}  {txt}")
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> HTTP {e.code} {e.reason}")
    except Exception as e:
        print(f"{method} {path} -> ERR {type(e).__name__}: {str(e)[:90]}")
