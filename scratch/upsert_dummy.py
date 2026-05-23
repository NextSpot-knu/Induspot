import csv
import json
import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def load_dummy_to_supabase():
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        csv_path = "../samples/dummy.csv"
        
        facilities = []
        with open(csv_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # JSON fields
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
        
        print(f"Read {len(facilities)} facilities from dummy.csv.")
        
        # Upsert in chunks (e.g., to prevent query size limit)
        for i in range(0, len(facilities), 10):
            chunk = facilities[i:i+10]
            res = supabase.table("facilities").upsert(chunk).execute()
            print(f"Upserted chunk {i//10 + 1}: {len(res.data)} items.")
            
        print("Upsert completed successfully!")
        
    except Exception as e:
        print(f"Error upserting dummy data: {e}")

if __name__ == "__main__":
    load_dummy_to_supabase()
