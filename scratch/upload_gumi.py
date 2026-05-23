import csv
import json
import random
import os
from datetime import datetime, timezone
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def upload_gumi_data():
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        csv_path = "../samples/gumi_facilities.csv"
        
        # 1. 기존 모든 시설 데이터 삭제 (CASCADE에 의해 congestion_logs 등 연관 데이터 자동 삭제됨)
        # API 상에서 delete().neq('id', '00000000-0000-0000-0000-000000000000') 방식을 쓰거나
        # 전체 행 삭제 허용을 위해 빈 필터 처리
        print("Cleaning up old facilities data in Supabase...")
        supabase.table("facilities").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        
        # 2. gumi_facilities.csv 로드
        facilities = []
        with open(csv_path, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    operating_hours = json.loads(row["operating_hours"])
                except Exception:
                    operating_hours = {}
                    
                try:
                    features = json.loads(row["features"])
                except Exception:
                    features = {}
                
                facility = {
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "capacity": int(row["capacity"]),
                    "operating_hours": operating_hours,
                    "features": features
                }
                facilities.append(facility)
        
        print(f"Loaded {len(facilities)} facilities from gumi_facilities.csv.")
        
        # 3. 데이터 삽입
        for i in range(0, len(facilities), 10):
            chunk = facilities[i:i+10]
            res = supabase.table("facilities").insert(chunk).execute()
            print(f"Inserted facilities chunk {i//10 + 1}: {len(res.data)} items.")
            
        # 4. 실시간 혼잡도 로그(congestion_logs) 생성 및 삽입
        # 15개 여유(0.0~0.3), 15개 보통(0.3~0.7), 10개 혼잡(0.7~1.0)
        random.shuffle(facilities)
        logs = []
        now_str = datetime.now(timezone.utc).isoformat()
        
        for idx, f in enumerate(facilities):
            fid = f["id"]
            capacity = f["capacity"]
            
            if idx < 15:
                level = round(random.uniform(0.05, 0.28), 2)
            elif idx < 30:
                level = round(random.uniform(0.35, 0.65), 2)
            else:
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
            
        for i in range(0, len(logs), 10):
            chunk = logs[i:i+10]
            res_logs = supabase.table("congestion_logs").insert(chunk).execute()
            print(f"Inserted logs chunk {i//10 + 1}: {len(res_logs.data)} items.")
            
        print("Gumi facilities and fresh congestion logs upload completed successfully!")
        
    except Exception as e:
        print(f"Error uploading Gumi data: {e}")

if __name__ == "__main__":
    upload_gumi_data()
