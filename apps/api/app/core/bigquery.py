"""WP2 — 공유 BigQuery 헬퍼 (Stream A 제공, Stream B 소비).

역할:
  - get_bq_client():            lazy 싱글톤 BigQuery 클라이언트 (GCP_PROJECT_ID 게이팅, 절대 raise 안 함)
  - insert_congestion_rows():   `{project}.{dataset}.congestion_logs` 스트리밍 인서트 (실패 시 0 반환)
  - query_forecast():           `{dataset}.congestion_forecast_lookup` 조회 (실패 시 [] 반환)

가드레일:
  - import/호출 어느 시점에도 절대 죽지 않는다. GCP 미설정/SDK 미설치/네트워크 실패는
    모두 structlog 경고로 남기고 안전 폴백(None / 0 / [])으로 내려간다.
  - bq_forecast_service._get_client() 와 동일한 lazy 패턴(한 번만 init 시도).
  - 테이블명은 settings 에서만 가져온다(하드코딩 금지).
"""

from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

# lazy 싱글톤: 최초 1회만 init 시도하고, 실패하면 None 을 캐시해 재시도하지 않는다.
_bq_client = None
_bq_init_attempted = False

# settings 에 신규 테이블명이 없을 수도 있으므로 getattr 로 안전하게 기본값을 얻는다.
_CONGESTION_TABLE = getattr(settings, "BQ_CONGESTION_TABLE", "congestion_logs")
_FORECAST_TABLE = getattr(settings, "BQ_FORECAST_TABLE", "congestion_forecast_lookup")


def get_bq_client():
    """lazy BigQuery 클라이언트. GCP_PROJECT_ID 미설정/실패 시 None. 절대 raise 안 함."""
    global _bq_client, _bq_init_attempted
    if _bq_init_attempted:
        return _bq_client
    _bq_init_attempted = True

    if not settings.GCP_PROJECT_ID:
        # GCP 비활성화 환경: 폴백 경로로 동작
        logger.info("bq_client_disabled", reason="no GCP_PROJECT_ID")
        return None
    try:
        from google.cloud import bigquery  # lazy import

        _bq_client = bigquery.Client(
            project=settings.GCP_PROJECT_ID, location=settings.BQ_LOCATION
        )
        logger.info("bq_client_initialized", dataset=settings.BQ_DATASET)
    except Exception as e:
        logger.warning("bq_client_init_failed", error=str(e))
        _bq_client = None
    return _bq_client


def insert_congestion_rows(rows: list[dict]) -> int:
    """`congestion_logs` 로 스트리밍 인서트. 적재된 행 수 반환. 실패 시 0(절대 raise 안 함).

    각 row 허용 키: facility_id, congestion_level, current_count, source, timestamp(선택, ISO str).
    """
    if not rows:
        return 0
    client = get_bq_client()
    if client is None:
        return 0
    try:
        table_ref = (
            f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET}.{_CONGESTION_TABLE}"
        )
        # 계약 키만 추려서 스키마 표류를 막는다(예상치 못한 키가 insert 에러를 내지 않도록).
        clean_rows = []
        for r in rows:
            row = {
                "facility_id": r.get("facility_id"),
                "congestion_level": r.get("congestion_level"),
                "current_count": r.get("current_count"),
                "source": r.get("source"),
            }
            if r.get("timestamp"):
                row["timestamp"] = r["timestamp"]
            clean_rows.append(row)

        errors = client.insert_rows_json(table_ref, clean_rows)
        if errors:
            logger.warning("bq_insert_partial_failure", errors=str(errors)[:500])
            # insert_rows_json 은 실패한 행만 errors 에 담는다. 성공 행수 = 전체 - 실패.
            return max(0, len(clean_rows) - len(errors))
        return len(clean_rows)
    except Exception as e:
        logger.warning("bq_insert_failed", error=str(e), count=len(rows))
        return 0


def query_forecast(facility_id: Optional[str] = None, hours: int = 48) -> list[dict]:
    """`congestion_forecast_lookup` 조회. 실패 시 [](절대 raise 안 함).

    반환 row: {facility_id, forecast_timestamp(iso), forecast_congestion}.
    facility_id 가 주어지면 해당 시설만, None 이면 전 시설을 대상으로 한다.
    'CURRENT_TIMESTAMP ~ +hours' 구간의 미래 예측만 반환한다.
    """
    client = get_bq_client()
    if client is None:
        return []
    try:
        from google.cloud import bigquery  # lazy import

        table = f"{settings.GCP_PROJECT_ID}.{settings.BQ_DATASET}.{_FORECAST_TABLE}"
        params = [bigquery.ScalarQueryParameter("hours", "INT64", int(hours))]
        where = [
            "forecast_timestamp >= CURRENT_TIMESTAMP()",
            "forecast_timestamp < TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)",
        ]
        if facility_id:
            where.append("facility_id = @facility_id")
            params.append(
                bigquery.ScalarQueryParameter("facility_id", "STRING", facility_id)
            )

        query = f"""
            SELECT facility_id, forecast_timestamp, forecast_congestion
            FROM `{table}`
            WHERE {' AND '.join(where)}
            ORDER BY facility_id, forecast_timestamp
        """
        job_config = bigquery.QueryJobConfig(query_parameters=params)
        result = client.query(query, job_config=job_config).result(timeout=10.0)

        out: list[dict] = []
        for row in result:
            ts = row["forecast_timestamp"]
            out.append(
                {
                    "facility_id": row["facility_id"],
                    "forecast_timestamp": ts.isoformat() if ts is not None else None,
                    "forecast_congestion": float(row["forecast_congestion"])
                    if row["forecast_congestion"] is not None
                    else None,
                }
            )
        return out
    except Exception as e:
        logger.warning(
            "bq_forecast_series_query_failed", facility_id=facility_id, error=str(e)
        )
        return []
