from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.predict_service import predict_congestion_with_source

router = APIRouter(tags=["predict"])

class PredictRequest(BaseModel):
    facility_type: str = Field(..., description="Facility type (e.g., cafeteria, parking, meeting_room, rest_area)")
    hour: int = Field(..., ge=0, le=23, description="Hour of the day (0-23)")
    day_of_week: int = Field(..., ge=0, le=6, description="Day of the week (0-6, where 0=Monday, 6=Sunday)")

class PredictResponse(BaseModel):
    predicted_congestion: float
    # 추론 출처: vertex|gcs|local|default. Vertex 라이브 호출과 폴백을 호출자가 구분할 수 있게 노출한다
    # (폴백 마스킹 방지). 기존 클라이언트는 predicted_congestion 만 읽으므로 하위호환(추가 필드).
    source: str = "default"

@router.post("", response_model=PredictResponse)
def predict_endpoint(req: PredictRequest):
    # 공개 조회용(무인증) 엔드포인트다. 1차 방어는 Cloud Run IAM(run.invoker)이며, 비용 측면에서도
    # VERTEX_ENDPOINT_ID 미설정 시 0.5 폴백이라 부담이 없다. 내부 전용으로 닫으려면
    # get_current_user 의존성을 추가하면 된다(응답 스키마 불변).
    pred, source = predict_congestion_with_source(req.facility_type, req.hour, req.day_of_week)
    return PredictResponse(predicted_congestion=pred, source=source)
