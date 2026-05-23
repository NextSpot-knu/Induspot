import os
import requests
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # 1. facilities 개수 확인
    fac_res = supabase.table("facilities").select("id, name, type").execute()
    print(f"Total Facilities in DB: {len(fac_res.data)}")
    
    # 2. congestion_logs 개수 확인
    log_res = supabase.table("congestion_logs").select("congestion_level", count="exact").limit(10).execute()
    print(f"Total Congestion Logs in DB: {log_res.count}")
    
    # 3. 각 시설별 최신 로그 값 분포 확인
    logs_res = supabase.table("congestion_logs").select("facility_id, congestion_level, timestamp").order("timestamp", desc=True).execute()
    
    latest_logs = {}
    for log in logs_res.data:
        fid = log["facility_id"]
        if fid not in latest_logs:
            latest_logs[fid] = log["congestion_level"]
            
    print("\nLatest Congestion Levels per Facility:")
    levels = list(latest_logs.values())
    print(f"Mapped facilities count with logs: {len(levels)}")
    print(f"Levels: {levels}")
    
    # 0~0.3 구간, 0.3~0.7 구간, 0.7~1.0 구간 개수
    under_30 = len([l for l in levels if l <= 0.3])
    mid_70 = len([l for l in levels if 0.3 < l < 0.7])
    above_70 = len([l for l in levels if l >= 0.7])
    
    print(f"Under 30%: {under_30}")
    print(f"30% - 70%: {mid_70}")
    print(f"Above 70%: {above_70}")
    
    # logs가 없는 시설 개수
    all_fids = [f["id"] for f in fac_res.data]
    no_logs = [fid for fid in all_fids if fid not in latest_logs]
    print(f"Facilities with NO logs (will default to 0.0%): {len(no_logs)}")

except Exception as e:
    print(f"Error checking DB: {e}")
