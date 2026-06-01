"""읽기 전용 검증: 엔드포인트에 배포된 모델 목록을 조회하고, 배포돼 있으면 실제 예측을 호출한다.
어떤 리소스도 생성/변경하지 않는다. 결과를 _verify_endpoint.out 에 기록."""
import json
from google.cloud import aiplatform

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
ENDPOINT_ID = "2992545745120264192"
OUT = "scripts/_verify_endpoint.out"

lines = []
def w(s):
    lines.append(str(s))

aiplatform.init(project=PROJECT, location=LOCATION)
ep = aiplatform.Endpoint(ENDPOINT_ID)

dms = ep.list_models()
w(f"DEPLOYED_MODEL_COUNT={len(dms)}")
for dm in dms:
    w(f"DEPLOYED id={dm.id} model={dm.model} display={dm.display_name}")

if dms:
    try:
        resp = ep.predict(instances=[["cafeteria", "12", "2"], ["parking", "9", "0"], ["meeting_room", "15", "4"]])
        w(f"SMOKE_OK predictions={resp.predictions}")
    except Exception as e:
        w(f"SMOKE_FAIL {type(e).__name__}: {str(e)[:200]}")
else:
    w("NO_DEPLOYED_MODEL — 배포 미완 또는 실패")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print("\n".join(lines))
