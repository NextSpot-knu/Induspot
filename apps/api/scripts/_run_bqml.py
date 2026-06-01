"""WP2 — BQML ARIMA_PLUS 모델 + ML.FORECAST lookup 생성/검증 (python BigQuery 클라이언트).
이 머신의 bq CLI 는 gcloud 자격증명 경로(WinError 2)로 깨져 있어 python 경로를 쓴다.
ADC 인증. 리전 us-central1."""
import sys
from google.cloud import bigquery

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
DS = "induspot"
client = bigquery.Client(project=PROJECT, location=LOCATION)


def run(label, sql, show=False):
    print(f"\n=== {label} ===")
    job = client.query(sql)
    rows = list(job.result())
    print(f"  done. rows={len(rows)}")
    if show:
        for r in rows[:8]:
            print("  ", dict(r))
    return rows


# 1) ARIMA_PLUS 모델 (시설별). 학습은 수 분 소요.
run("CREATE MODEL congestion_forecast", f"""
CREATE OR REPLACE MODEL `{PROJECT}.{DS}.congestion_forecast`
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
SELECT facility_id, ts, congestion
FROM `{PROJECT}.{DS}.congestion_logs`
WHERE congestion IS NOT NULL
""")

# 3) 사전계산 lookup 테이블 (horizon 48)
run("CREATE TABLE congestion_forecast_lookup", f"""
CREATE OR REPLACE TABLE `{PROJECT}.{DS}.congestion_forecast_lookup` AS
SELECT
  facility_id,
  forecast_timestamp,
  GREATEST(0.0, LEAST(1.0, forecast_value)) AS forecast_congestion,
  GREATEST(0.0, LEAST(1.0, prediction_interval_lower_bound)) AS lower_bound,
  GREATEST(0.0, LEAST(1.0, prediction_interval_upper_bound)) AS upper_bound,
  CURRENT_TIMESTAMP() AS computed_at
FROM ML.FORECAST(
  MODEL `{PROJECT}.{DS}.congestion_forecast`,
  STRUCT(48 AS horizon, 0.9 AS confidence_level)
)
""")

# 4) 검증: lookup 행수 + 시설별 샘플
run("VERIFY lookup count", f"""
SELECT COUNT(*) AS n, COUNT(DISTINCT facility_id) AS facilities
FROM `{PROJECT}.{DS}.congestion_forecast_lookup`
""", show=True)

run("VERIFY sample forecast", f"""
SELECT facility_id, forecast_timestamp, ROUND(forecast_congestion,4) AS fc
FROM `{PROJECT}.{DS}.congestion_forecast_lookup`
ORDER BY facility_id, forecast_timestamp
LIMIT 6
""", show=True)

print("\nBQML_OK")
