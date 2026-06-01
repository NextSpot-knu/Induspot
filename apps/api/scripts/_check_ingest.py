"""읽기/진단: 실제 facility_id로 ingest insert 를 그대로 재현해 Supabase 가 왜 400을 주는지 확인."""
import os
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

url = os.getenv("SUPABASE_URL")
srk = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
anon = os.getenv("SUPABASE_ANON_KEY")
sb = create_client(url, srk or anon)
print("USING_KEY:", "service_role" if srk else "anon")

# 실제 존재하는 facility_id 하나 확보
f = sb.table("facilities").select("id,type").limit(1).execute().data[0]
fid = f["id"]
print("facility:", fid, f["type"])

# ingest.py 가 만드는 row 와 동일한 형태 (timestamp 포함 안 함 → DB default)
row = {
    "facility_id": fid,
    "congestion_level": 0.42,
    "current_count": 7,
    "source": "cctv",
    "timestamp": "2026-06-01T09:50:33+00:00",
}
print("INSERT row:", row)
try:
    r = sb.table("congestion_logs").insert(row).execute()
    print("INSERT_OK:", len(r.data), "row(s). id=", r.data[0]["id"] if r.data else None)
except Exception as e:
    print("INSERT_FAIL:", type(e).__name__, str(e)[:400])
