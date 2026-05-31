from datetime import datetime, timedelta
from pydantic import BaseModel
from app.services.tttv.preference import calculate_preference_similarity
from app.services.tttv.wait_time import calculate_predicted_wait_time
from app.services.tttv.travel import get_travel_time_and_distance
from app.services.predict_service import predict_congestion

# 가중치 정의
W1 = 0.4  # 선호도 가중치
W2 = 0.4  # 시간 비용(대기+이동) 가중치
W3 = 0.2  # 혼잡 분산 인센티브 가중치

class TTTVScoreResult(BaseModel):
    score: float
    breakdown: dict  # { preference, wait_time, travel_time, incentive }

async def calculate_tttv_score(
    user_id: str,
    preferred_categories: list[str],
    original_facility_type: str,
    original_congestion_level: float,
    candidate_facility: dict,      # id, type, latitude, longitude, capacity, features 등 포함
    candidate_congestion_level: float,
    user_lat: float,
    user_lng: float
) -> TTTVScoreResult:
    """
    사용자 정보, 원본 시설 혼잡 정보, 후보 대안 시설 정보 및 사용자 현재 위치를 입력받아
    TTTV(Total Time to Value) 추천 스코어를 산출합니다.
    """
    # 1. 선호도 코사인 유사도 (w1)
    preference_sim = await calculate_preference_similarity(
        user_id=user_id,
        facility_type=candidate_facility["type"],
        preferred_categories=preferred_categories,
        facility_features=candidate_facility.get("features")
    )

    # --- 시간비용 계산 수정 전후 명시 ---
    # [수정 전 - 기존 시간비용 계산 로직]
    # predicted_wait = await calculate_predicted_wait_time(
    #     facility_type=candidate_facility["type"],
    #     congestion_level=candidate_congestion_level,
    #     facility_features=candidate_facility.get("features")
    # )
    # travel_time_min, distance_m = await get_travel_time_and_distance(
    #     start_lat=user_lat,
    #     start_lng=user_lng,
    #     end_lat=candidate_facility["latitude"],
    #     end_lng=candidate_facility["longitude"]
    # )
    # total_time = predicted_wait + travel_time_min
    # time_cost = min(1.0, total_time / 60.0)

    # [수정 후 - 변경된 시간비용 계산 로직]
    # 2. 이동 시간 우선 획득
    travel_time_min, distance_m = await get_travel_time_and_distance(
        start_lat=user_lat,
        start_lng=user_lng,
        end_lat=candidate_facility["latitude"],
        end_lng=candidate_facility["longitude"]
    )

    # 3. 도착 예상 시점 혼잡도 예측
    arrival_dt = datetime.now() + timedelta(minutes=travel_time_min)
    arrival_hour = arrival_dt.hour
    arrival_dow = arrival_dt.weekday()
    predicted_congestion = predict_congestion(
        facility_type=candidate_facility["type"],
        hour=arrival_hour,
        day_of_week=arrival_dow
    )

    # 4. 예측 혼잡도를 적용한 대기 시간 계산
    predicted_wait = await calculate_predicted_wait_time(
        facility_type=candidate_facility["type"],
        congestion_level=predicted_congestion,
        facility_features=candidate_facility.get("features")
    )

    total_time = predicted_wait + travel_time_min
    time_cost = min(1.0, total_time / 60.0)

    # 5. 혼잡도 분산 기여 인센티브 (w3)
    # 기존에 요청했던 혼잡 시설에서 덜 혼잡한 후보 시설로 갈수록 높은 인센티브를 부여
    incentive = max(0.0, original_congestion_level - candidate_congestion_level)

    # 6. TTTV 종합 스코어 계산
    # 선호도가 높을수록(+), 시간 비용이 적을수록(+), 인센티브가 높을수록(+) 점수가 높음
    # 공식: w1 * preference - w2 * time_cost + w3 * incentive
    tttv_score = (W1 * preference_sim) - (W2 * time_cost) + (W3 * incentive)

    # 스코어를 [0.0, 1.0] 범위로 정규화 및 소수점 3자리 반올림
    final_score = round(max(0.0, min(1.0, tttv_score)), 3)

    return TTTVScoreResult(
        score=final_score,
        breakdown={
            "preference": round(preference_sim, 3),
            "wait_time": predicted_wait,
            "travel_time": travel_time_min,
            "incentive": round(incentive, 3)
        }
    )
