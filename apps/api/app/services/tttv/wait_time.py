from datetime import datetime

# 시설 타입별 기본 평균 처리 시간 (단위: 분)
DEFAULT_PROCESSING_TIMES = {
    "cafeteria": 20,
    "parking": 5,
    "meeting_room": 10,
    "rest_area": 10,      # 휴게 공간: 좌석/시설 이용 대기
    "loading_dock": 30,   # 레거시 호환
}

async def calculate_predicted_wait_time(
    facility_type: str,
    congestion_level: float,
    facility_features: dict = None
) -> float:
    """
    현재 혼잡도(congestion_level: 0.0 ~ 1.0)와 기본 처리 시간 및 시간대 보정을 적용해
    예측 대기 시간(분 단위)을 계산합니다.
    """
    # 1. 평균 처리 시간 획득
    avg_process_time = DEFAULT_PROCESSING_TIMES.get(facility_type, 15)
    if facility_features and "average_processing_time" in facility_features:
        avg_process_time = facility_features["average_processing_time"]

    # 2. 시간대 보정 계수 산출 (현재 시점 기준)
    now = datetime.now()
    hour = now.hour
    
    time_multiplier = 1.0
    if 12 <= hour < 14:
        # 점심 피크 보정 (12시 ~ 13시 59분)
        time_multiplier = 1.3
    elif hour == 7 or hour == 15:
        # 교대 근무 타임 보정 (07시, 15시)
        time_multiplier = 1.2

    # 3. 예측 대기 시간 공식 계산
    # 예측 대기 시간 = 혼잡도 * 평균 처리 시간 * 시간대 보정
    predicted_wait = congestion_level * avg_process_time * time_multiplier
    
    return round(predicted_wait, 1)
