"""읽기 전용: WP4 적재 확정 — 오늘 09~10시(UTC) 구간 publish 행을 직접 조회."""
import os
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

url = os.getenv("SUPABASE_URL")
srk = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
sb = create_client(url, srk or os.getenv("SUPABASE_ANON_KEY"))

total = sb.table("congestion_logs").select("id", count="exact").limit(1).execute()
print("TOTAL_ROWS:", total.count)

# publish_events 의 ts 는 datetime.now(utc) → 오늘 09~10시 UTC 구간
res = (sb.table("congestion_logs")
       .select("facility_id, timestamp, congestion_level, source, current_count")
       .gte("timestamp", "2026-06-01T09:00:00+00:00")
       .lt("timestamp", "2026-06-01T11:00:00+00:00")
       .order("timestamp", desc=True).limit(10).execute())
print("PUBLISH_WINDOW_ROWS(09~11 UTC):", len(res.data))
for r in res.data[:8]:
    print("  ", r["timestamp"], "src=", r["source"], "cong=", r["congestion_level"], "cnt=", r["current_count"])
