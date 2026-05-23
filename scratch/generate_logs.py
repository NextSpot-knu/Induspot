import random
import os
from datetime import datetime, timezone
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def generate_random_congestion_logs():
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # 1. 모든 시설 목록 가져오기
        res = supabase.table("facilities").select("id, name, type, capacity").execute()
        facilities = res.data
        print(f"Fetched {len(facilities)} facilities to generate logs.")
        
        # 2. 혼잡도 구간별로 무작위 배정
        # 15개: 여유 (0.0 ~ 0.3), 15개: 보통 (0.3 ~ 0.7), 10개: 혼잡 (0.7 ~ 1.0)
        random.shuffle(facilities)
        
        logs = []
        now_str = datetime.now(timezone.utc).isoformat()
        
        for idx, f in enumerate(facilities):
            fid = f["id"]
            capacity = f["capacity"]
            
            if idx < 15:
                # 여유 (under 30%)
                level = round(random.uniform(0.05, 0.28), 2)
            elif idx < 30:
                # 보통 (30% ~ 70%)
                level = round(random.uniform(0.35, 0.65), 2)
            else:
                # 혼잡 (above 70%)
                level = round(random.uniform(0.72, 0.95), 2)
                
            current_count = int(capacity * level)
            source = "iot_sensor" if f["type"] in ["parking", "loading_dock"] else "cctv"
            
            log = {
                "facility_id": fid,
                "congestion_level": level,
                "current_count": current_count,
                "source": source,
                "timestamp": now_str
            }
            logs.append(log)
            
        # 3. DB에 INSERT
        for i in range(0, len(logs), 10):
            chunk = logs[i:i+10]
            res_insert = supabase.table("congestion_logs").insert(chunk).execute()
            print(f"Inserted logs chunk {i//10 + 1}: {len(res_insert.data)} logs.")
            
        print("Successfully generated and inserted fresh congestion logs for all 40 facilities!")
        
    except Exception as e:
        print(f"Error generating logs: {e}")

if __name__ == "__main__":
    generate_random_congestion_logs()
