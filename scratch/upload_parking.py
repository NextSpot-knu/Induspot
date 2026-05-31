import csv
import json
import random
import os
import uuid
from datetime import datetime, timezone
from supabase import create_client
from dotenv import load_dotenv

# Try loading from local directory or parent directory
if os.path.exists(".env"):
    load_dotenv(".env")
elif os.path.exists("../.env"):
    load_dotenv("../.env")
else:
    load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def upload_parking_data():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in .env")
        return
        
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # Find csv path
        csv_path = "samples/gumi_parking.csv"
        if not os.path.exists(csv_path):
            csv_path = "../samples/gumi_parking.csv"
            if not os.path.exists(csv_path):
                # Try finding based on file directory
                current_dir = os.path.dirname(os.path.abspath(__file__))
                csv_path = os.path.join(current_dir, "../samples/gumi_parking.csv")
                
        print(f"Reading parking data from: {csv_path}")
        
        facilities = []
        with open(csv_path, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Parse features
                try:
                    features = json.loads(row["features"]) if row["features"] and row["features"] != "null" else {}
                except Exception as ex:
                    print(f"Error parsing features for {row.get('name')}: {ex}")
                    features = {}
                    
                # Parse operating_hours
                try:
                    operating_hours = json.loads(row["operating_hours"]) if row["operating_hours"] and row["operating_hours"] != "null" else {}
                except Exception as ex:
                    print(f"Error parsing operating_hours for {row.get('name')}: {ex}")
                    operating_hours = {}

                # Parse capacity / max_capacity_vehicles
                max_capacity_vehicles = None
                if "max_capacity_vehicles" in row and row["max_capacity_vehicles"] and row["max_capacity_vehicles"] != "null":
                    try:
                        max_capacity_vehicles = int(row["max_capacity_vehicles"])
                    except ValueError:
                        pass
                if max_capacity_vehicles is None:
                    max_capacity_vehicles = int(row["capacity"]) if row["capacity"] and row["capacity"] != "null" else 50
                
                capacity = max_capacity_vehicles

                # Create UUID
                facility_id = str(uuid.uuid4())
                
                facility = {
                    "id": facility_id,
                    "name": row["name"],
                    "type": "parking",
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "capacity": capacity,
                    "max_capacity_vehicles": max_capacity_vehicles,
                    "operating_hours": operating_hours,
                    "features": features
                }
                facilities.append(facility)
        
        print(f"Loaded {len(facilities)} parking lots from CSV.")
        if not facilities:
            print("No parking lots found to upload.")
            return

        # Insert parking lots into facilities table (no delete, only insert)
        print("Inserting parking facilities into Supabase...")
        res = supabase.table("facilities").insert(facilities).execute()
        inserted_facilities = res.data
        print(f"Successfully inserted {len(inserted_facilities)} facilities.")
        
        # Generate congestion logs for the new facilities
        print("Generating and uploading congestion logs for new parking facilities...")
        logs = []
        now_str = datetime.now(timezone.utc).isoformat()
        
        for f in inserted_facilities:
            fid = f["id"]
            capacity = f["capacity"]
            
            # Parking congestion distribution
            rand_val = random.random()
            if rand_val < 0.4:
                level = round(random.uniform(0.05, 0.29), 2)
            elif rand_val < 0.8:
                level = round(random.uniform(0.30, 0.69), 2)
            else:
                level = round(random.uniform(0.70, 0.95), 2)
                
            current_count = int(capacity * level)
            source = "iot_sensor"
            
            log = {
                "facility_id": fid,
                "congestion_level": level,
                "current_count": current_count,
                "source": source,
                "timestamp": now_str
            }
            logs.append(log)
            
        res_logs = supabase.table("congestion_logs").insert(logs).execute()
        print(f"Successfully inserted {len(res_logs.data)} congestion logs.")
        print("Supabase parking data upload completed successfully!")
        
    except Exception as e:
        print(f"Error uploading parking data: {e}")

if __name__ == "__main__":
    upload_parking_data()
