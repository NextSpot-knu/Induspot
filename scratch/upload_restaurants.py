import csv
import json
import random
import os
import uuid
from datetime import datetime, timezone
from supabase import create_client
from dotenv import load_dotenv

# 루트 경로의 .env 파일 로드
load_dotenv(dotenv_path="../.env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def upload_restaurants_data():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in .env")
        return
        
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        csv_path = "../samples/gumi_restaurants_grouped.csv"
        
        # 1. 기존 데이터 삭제 (외래키 제약조건 방지를 위해 자식 테이블부터 순서대로 삭제)
        print("Cleaning up old data in Supabase...")
        supabase.table("user_feedback").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        supabase.table("recommendations").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        supabase.table("facilities").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        
        # 2. gumi_restaurants_grouped.csv 로드
        facilities = []
        with open(csv_path, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # features JSON 로드
                try:
                    features = json.loads(row["features"])
                except Exception:
                    features = {}
                    
                # null 값들 현실적인 값으로 채우기
                capacity = random.randint(30, 120)
                operating_hours = {
                    "weekday": "11:00-21:00",
                    "weekend": "11:00-20:00"
                }
                
                # DB의 type check constraint(cafeteria, parking, meeting_room, loading_dock)에 맞추기 위해
                # 수집된 식당/카페/바/패스트푸드 등의 타입을 모두 'cafeteria'로 매핑합니다.
                facility_type = "cafeteria"
                
                facility = {
                    "id": str(uuid.uuid4()), # 새로운 UUID 생성
                    "name": row["name"],
                    "type": facility_type,
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "capacity": capacity,
                    "operating_hours": operating_hours,
                    "features": features
                }
                facilities.append(facility)
        
        print(f"Loaded {len(facilities)} restaurants from CSV.")
        
        # 3. 데이터 삽입 (100개씩 청크 분할 삽입)
        inserted_facilities = []
        chunk_size = 100
        for i in range(0, len(facilities), chunk_size):
            chunk = facilities[i:i+chunk_size]
            res = supabase.table("facilities").insert(chunk).execute()
            inserted_facilities.extend(res.data)
            print(f"Inserted facilities chunk {i//chunk_size + 1}: {len(res.data)} items.")
            
        # 4. 실시간 혼잡도 로그(congestion_logs) 생성 및 삽입
        print("Generating and uploading congestion logs for all restaurants...")
        logs = []
        now_str = datetime.now(timezone.utc).isoformat()
        
        for idx, f in enumerate(inserted_facilities):
            fid = f["id"]
            capacity = f["capacity"]
            
            # 실감나는 데이터 분포: 여유(0.0~0.3) 40%, 보통(0.3~0.7) 40%, 혼잡(0.7~1.0) 20%
            rand_val = random.random()
            if rand_val < 0.4:
                level = round(random.uniform(0.05, 0.29), 2)
            elif rand_val < 0.8:
                level = round(random.uniform(0.30, 0.69), 2)
            else:
                level = round(random.uniform(0.70, 0.95), 2)
                
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
            
        # 로그 청크 분할 삽입
        for i in range(0, len(logs), chunk_size):
            chunk = logs[i:i+chunk_size]
            res_logs = supabase.table("congestion_logs").insert(chunk).execute()
            print(f"Inserted logs chunk {i//chunk_size + 1}: {len(res_logs.data)} items.")
            
        print("Supabase update completed successfully!")
        
    except Exception as e:
        print(f"Error updating Supabase: {e}")

if __name__ == "__main__":
    upload_restaurants_data()
