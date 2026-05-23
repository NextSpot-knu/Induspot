import csv
import json
import uuid
import os

def convert_gumi_csv():
    input_path = "../samples/gumi_facilities.csv"
    output_path = "../samples/gumi_facilities.csv"  # 덮어쓰기
    
    # 덮어쓰기 위해 일단 데이터를 메모리에 로드
    facilities = []
    
    with open(input_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # 1. UUID 생성
            facility_id = str(uuid.uuid4())
            
            # 2. operating_hours JSON 객체 생성
            ftype = row["type"]
            operating_hours = {}
            if ftype == "cafeteria":
                operating_hours = {"weekday": "11:00-20:00", "weekend": "11:00-14:00"}
            elif ftype == "parking":
                operating_hours = {"24_7": True}
            elif ftype == "meeting_room":
                operating_hours = {"weekday": "09:00-18:00", "weekend": "closed"}
            elif ftype == "loading_dock":
                operating_hours = {"24_7": True}
                
            # 3. features JSON 객체 생성
            orig_features = row.get("features", "")
            features_dict = {}
            
            if ftype == "cafeteria":
                features_dict = {
                    "has_vegetarian": "채식" in orig_features or "샐러드" in orig_features,
                    "average_price": 7500,
                    "cuisine_tags": [tag.strip() for tag in orig_features.split(",")] if orig_features else []
                }
            elif ftype == "parking":
                features_dict = {
                    "has_ev_charger": "전기차" in orig_features or "EV" in orig_features or True,  # 기본값 제공
                    "indoor": "지하" in row["name"] or "타워" in row["name"] or "실내" in orig_features,
                    "parking_type": orig_features.strip() if orig_features else "일반"
                }
            elif ftype == "meeting_room":
                features_dict = {
                    "has_beam_projector": "빔" in orig_features or "프로젝터" in orig_features or True,
                    "has_video_conf": "화상" in orig_features,
                    "room_type": orig_features.strip() if orig_features else "일반"
                }
            elif ftype == "loading_dock":
                features_dict = {
                    "max_tonnage": 15 if "컨테이너" in orig_features else 5,
                    "has_forklift": True,
                    "dock_type": orig_features.strip() if orig_features else "일반"
                }
                
            facility = {
                "id": facility_id,
                "name": row["name"],
                "type": ftype,
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "capacity": int(row["capacity"]),
                "operating_hours": json.dumps(operating_hours, ensure_ascii=False),
                "features": json.dumps(features_dict, ensure_ascii=False)
            }
            facilities.append(facility)
            
    # 다시 CSV로 작성
    fieldnames = ["id", "name", "type", "latitude", "longitude", "capacity", "operating_hours", "features"]
    with open(output_path, mode='w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for fac in facilities:
            writer.writerow(fac)
            
    print(f"Successfully converted gumi_facilities.csv! Wrote {len(facilities)} rows.")

if __name__ == "__main__":
    convert_gumi_csv()
