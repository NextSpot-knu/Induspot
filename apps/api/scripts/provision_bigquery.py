"""WP2 — BigQuery 프로비저닝(멱등): 데이터셋 + congestion_logs 테이블 + BQML ARIMA_PLUS 모델
+ congestion_forecast_lookup 사전계산 테이블 생성.

이 스크립트는 ZERO-DESTRUCTIVE 하게 재실행 가능하다:
  - 데이터셋:   create_dataset(exists_ok=True)        (IF NOT EXISTS)
  - 테이블:     create_table(exists_ok=True)          (IF NOT EXISTS, 기존 데이터 보존)
  - BQML 모델:  CREATE OR REPLACE MODEL               (재학습)
  - lookup:     CREATE OR REPLACE TABLE               (재계산)
성공 시 마지막에 "BQML_OK" 한 줄을 출력한다.

스키마(공유 계약과 일치):
  congestion_logs: facility_id STRING, congestion_level FLOAT64, current_count INT64,
                   source STRING, timestamp TIMESTAMP
주의: BQML ARIMA_PLUS 는 시간 컬럼/값 컬럼이 필요하므로 학습 SELECT 에서
  timestamp → 시간축, congestion_level → 값 으로 매핑한다(테이블 스키마는 불변).

실행(이 환경에서는 실행하지 않는다 — gcloud/ADC 자격증명 필요):
  cd apps/api
  poetry run python scripts/provision_bigquery.py

사전 셋업(별도 런북):
  gcloud services enable bigquery.googleapis.com
  # 실행 SA 에 roles/bigquery.jobUser + roles/bigquery.dataEditor

참고: scripts/load_bq.py(데이터셋/테이블 get-or-create 패턴),
      scripts/_run_bqml.py(python BigQuery 클라이언트로 BQML 실행 패턴),
      sql/bqml_forecast.sql(ARIMA_PLUS 옵션) 의 검증된 패턴을 재사용한다.
"""

import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

try:
    from dotenv import load_dotenv  # noqa: E402

    load_dotenv(os.path.join(parent_dir, ".env"))
except Exception:
    # dotenv 없거나 .env 없어도 ADC/환경변수로 동작 가능
    pass

from app.core.config import settings  # noqa: E402

CONGESTION_TABLE = "congestion_logs"
FORECAST_LOOKUP_TABLE = "congestion_forecast_lookup"
MODEL_NAME = "congestion_forecast"


def _congestion_schema(bigquery):
    """공유 계약 스키마. mode 는 스트리밍 인서트 호환을 위해 모두 NULLABLE."""
    return [
        bigquery.SchemaField("facility_id", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("congestion_level", "FLOAT64", mode="NULLABLE"),
        bigquery.SchemaField("current_count", "INT64", mode="NULLABLE"),
        bigquery.SchemaField("source", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("timestamp", "TIMESTAMP", mode="NULLABLE"),
    ]


def ensure_dataset(client, bigquery) -> str:
    """데이터셋 IF NOT EXISTS (location = settings.BQ_LOCATION)."""
    dataset_id = f"{client.project}.{settings.BQ_DATASET}"
    ds = bigquery.Dataset(dataset_id)
    ds.location = settings.BQ_LOCATION
    client.create_dataset(ds, exists_ok=True)
    print(f"OK dataset {dataset_id} ({settings.BQ_LOCATION})")
    return dataset_id


def ensure_congestion_table(client, bigquery) -> str:
    """congestion_logs 테이블 IF NOT EXISTS (기존 데이터 보존)."""
    table_ref = f"{client.project}.{settings.BQ_DATASET}.{CONGESTION_TABLE}"
    table = bigquery.Table(table_ref, schema=_congestion_schema(bigquery))
    client.create_table(table, exists_ok=True)
    print(f"OK table {table_ref}")
    return table_ref


def train_model(client, project: str) -> None:
    """ARIMA_PLUS 모델 CREATE OR REPLACE (재실행 안전). 학습은 수 분 소요.

    sql/bqml_forecast.sql 의 옵션을 따르되, congestion_logs 의 공유-계약 컬럼명
    (timestamp/congestion_level)을 ARIMA_PLUS 가 기대하는 시간축/값으로 매핑한다.
    """
    ds = settings.BQ_DATASET
    sql = f"""
CREATE OR REPLACE MODEL `{project}.{ds}.{MODEL_NAME}`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'congestion',
  time_series_id_col = 'facility_id',
  data_frequency = 'AUTO_FREQUENCY',
  auto_arima = TRUE,
  decompose_time_series = TRUE,
  clean_spikes_and_dips = TRUE
) AS
SELECT
  facility_id,
  timestamp AS ts,
  congestion_level AS congestion
FROM `{project}.{ds}.{CONGESTION_TABLE}`
WHERE congestion_level IS NOT NULL
  AND timestamp IS NOT NULL
"""
    print(f"... CREATE OR REPLACE MODEL {project}.{ds}.{MODEL_NAME} (학습 중, 수 분 소요)")
    client.query(sql).result()
    print(f"OK model {project}.{ds}.{MODEL_NAME}")


def materialize_lookup(client, project: str) -> None:
    """사전계산 lookup 테이블 CREATE OR REPLACE (horizon 48). forecast 를 [0,1] 클리핑."""
    ds = settings.BQ_DATASET
    sql = f"""
CREATE OR REPLACE TABLE `{project}.{ds}.{FORECAST_LOOKUP_TABLE}` AS
SELECT
  facility_id,
  forecast_timestamp,
  GREATEST(0.0, LEAST(1.0, forecast_value)) AS forecast_congestion,
  GREATEST(0.0, LEAST(1.0, prediction_interval_lower_bound)) AS lower_bound,
  GREATEST(0.0, LEAST(1.0, prediction_interval_upper_bound)) AS upper_bound,
  CURRENT_TIMESTAMP() AS computed_at
FROM ML.FORECAST(
  MODEL `{project}.{ds}.{MODEL_NAME}`,
  STRUCT(48 AS horizon, 0.9 AS confidence_level)
)
"""
    print(f"... CREATE OR REPLACE TABLE {project}.{ds}.{FORECAST_LOOKUP_TABLE}")
    client.query(sql).result()
    print(f"OK lookup {project}.{ds}.{FORECAST_LOOKUP_TABLE}")


def verify_lookup(client, project: str) -> None:
    ds = settings.BQ_DATASET
    sql = f"""
SELECT COUNT(*) AS n, COUNT(DISTINCT facility_id) AS facilities
FROM `{project}.{ds}.{FORECAST_LOOKUP_TABLE}`
"""
    for row in client.query(sql).result():
        print(f"VERIFY lookup rows={row['n']} facilities={row['facilities']}")


def main():
    if not settings.GCP_PROJECT_ID:
        print("ERROR: GCP_PROJECT_ID 누락.")
        sys.exit(1)

    try:
        from google.cloud import bigquery
    except ImportError:
        print("ERROR: google-cloud-bigquery 미설치. `poetry add google-cloud-bigquery` 후 재실행.")
        sys.exit(1)

    client = bigquery.Client(
        project=settings.GCP_PROJECT_ID, location=settings.BQ_LOCATION
    )
    project = client.project

    # 데이터셋·테이블은 필수(수집 듀얼라이트/조회 대상). 실패 시 예외 전파 → 비-0 종료(가시화).
    ensure_dataset(client, bigquery)
    ensure_congestion_table(client, bigquery)

    # BQML 모델 + 예측 lookup 은 best-effort: congestion_logs 에 학습 데이터가 없거나(빈 테이블)
    # 일시 오류면, 예측 라우트가 graceful 폴백(source=unavailable)하므로 비치명적으로 처리하고
    # 데이터 누적 후 `provision_bigquery.py` 재실행으로 학습한다(CREATE OR REPLACE, 멱등).
    try:
        train_model(client, project)
        materialize_lookup(client, project)
        verify_lookup(client, project)
        print("BQML_OK")
    except Exception as e:
        print(f"BQML_DEFERRED: 모델/예측 테이블 생성 보류 (데이터 부족 또는 일시 오류) - {e}")
        print("BQ_TABLES_OK")


if __name__ == "__main__":
    main()
