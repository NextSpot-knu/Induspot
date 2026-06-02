"""WP2 — BQML 사전계산 예측(lookup) 조회 라우터 (배치/대시보드 전용).

가드레일: 실시간 단건 예측의 1차 경로는 WP1 Vertex Endpoint(/predict)다. 이 라우터는 그
경로를 대체하지 않는다. `induspot.congestion_forecast_lookup`(ARIMA_PLUS 사전계산 결과)을
조회하는 별도 경로로, 관리자 대시보드의 예측 곡선/히트맵 등 시계열 용도로만 쓴다.

엔드포인트:
  GET /api/v1/forecast/congestion?facility_id=...  특정 시설의 '지금 이후 가장 가까운' 예측 혼잡도
  GET /api/v1/forecast/heatmap?hours=24            전 시설 향후 N시간 예측 시계열(히트맵용)

인증: predict.py 와 동일하게 무인증 공개 조회(1차 방어 = Cloud Run IAM run.invoker).
폴백: 데이터/모델이 없으면 source="unavailable" + None/빈 배열을 반환한다.
      (프런트엔드는 이미 의사난수 폴백을 가지고 있어 데모가 깨지지 않는다.)
"""

from fastapi import APIRouter, Query

from app.services import bq_forecast_service
from app.core import bigquery as bq

router = APIRouter(prefix="/api/v1/forecast", tags=["forecast"])


@router.get("/congestion")
def forecast_congestion(facility_id: str = Query(..., description="Facility ID")):
    """특정 시설의 사전계산 예측 혼잡도(없으면 source=unavailable)."""
    value = bq_forecast_service.get_forecast_congestion(facility_id)
    if value is None:
        return {
            "facility_id": facility_id,
            "forecast_congestion": None,
            "source": "unavailable",
        }
    return {
        "facility_id": facility_id,
        "forecast_congestion": value,
        "source": "bqml",
    }


@router.get("/heatmap")
def forecast_heatmap(
    hours: int = Query(24, ge=1, le=168, description="Forecast horizon in hours"),
):
    """전 시설 향후 N시간 예측 시계열(히트맵용). 데이터 없으면 source=unavailable + 빈 배열."""
    points = bq.query_forecast(facility_id=None, hours=hours)
    if not points:
        return {"source": "unavailable", "points": []}
    return {"source": "bqml", "points": points}
