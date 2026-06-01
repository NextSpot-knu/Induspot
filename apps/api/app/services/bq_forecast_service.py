"""WP2 — BQML 사전계산 예측(lookup) 조회 헬퍼 (선택적/배치 서사 전용).

가드레일: 실시간 단건 예측의 1차 경로는 WP1 Vertex Endpoint다. 이 모듈은 그 경로를
**대체하지 않는다.** `induspot.congestion_forecast_lookup`(ARIMA_PLUS 사전계산 결과)을
조회하는 별도 경로로, 관리자 대시보드의 예측 곡선 등 배치/시계열 용도로만 쓴다.

모든 BigQuery 호출에 타임아웃 + 폴백(None) 적용.
"""

from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

_bq_client = None
_bq_init_attempted = False


def _get_client():
    global _bq_client, _bq_init_attempted
    if _bq_init_attempted:
        return _bq_client
    _bq_init_attempted = True
    try:
        from google.cloud import bigquery

        _bq_client = bigquery.Client(
            project=settings.GCP_PROJECT_ID, location=settings.BQ_LOCATION
        )
        logger.info("bq_client_initialized", dataset=settings.BQ_DATASET)
    except Exception as e:
        logger.warning("bq_client_init_failed", error=str(e))
        _bq_client = None
    return _bq_client


def get_forecast_congestion(facility_id: str, timeout: float = 5.0) -> Optional[float]:
    """해당 시설의 '지금 이후 가장 가까운' 사전계산 예측 혼잡도를 반환. 실패 시 None."""
    client = _get_client()
    if client is None:
        return None
    try:
        from google.cloud import bigquery

        table = f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET}.congestion_forecast_lookup"
        query = f"""
            SELECT forecast_congestion
            FROM `{table}`
            WHERE facility_id = @facility_id
              AND forecast_timestamp >= CURRENT_TIMESTAMP()
            ORDER BY forecast_timestamp
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("facility_id", "STRING", facility_id)
            ]
        )
        result = client.query(query, job_config=job_config).result(timeout=timeout)
        for row in result:
            return float(row["forecast_congestion"])
    except Exception as e:
        logger.warning("bq_forecast_query_failed", facility_id=facility_id, error=str(e))
    return None
