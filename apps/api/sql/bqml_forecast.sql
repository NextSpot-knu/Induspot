-- WP2 — BigQuery ML 시계열 혼잡 예측 (ARIMA_PLUS)
--
-- 전제: scripts/load_bq.py 로 `induspot.congestion_logs` 가 적재되어 있어야 한다.
--   공유 계약 스키마: facility_id STRING, congestion_level FLOAT64, current_count INT64, source STRING, timestamp TIMESTAMP
--   (ARIMA_PLUS 는 ts/congestion 컬럼을 기대하므로 아래 SELECT 에서 timestamp/congestion_level 을 alias 한다.)
--
-- 실행:
--   bq query --use_legacy_sql=false < apps/api/sql/bqml_forecast.sql
--   (또는 BigQuery 콘솔에 붙여넣어 순서대로 실행)
--
-- 역할 분리(가드레일): 실시간 단건 예측의 1차 경로는 WP1의 Vertex Endpoint다.
--   BQML은 latency 때문에 실시간 단건에 부적합하므로, 여기서는 "배치 사전계산 + lookup 조회"
--   용도로만 쓴다. 두 경로는 공존한다.
--
-- 버전 주의: BQML 옵션명/지원 옵션은 시점에 따라 바뀐다. 실행 시 BQML 공식 문서로 최신값 확인.

-- =====================================================================
-- 1) 시계열 모델 생성 (시설별 ARIMA_PLUS)
--    time_series_id_col 로 facility_id 를 주면 시설마다 개별 모델이 학습된다.
-- =====================================================================
CREATE OR REPLACE MODEL `induspot.congestion_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'congestion',
  time_series_id_col = 'facility_id',
  data_frequency = 'AUTO_FREQUENCY',   -- 로그 간격을 자동 추론
  auto_arima = TRUE,
  decompose_time_series = TRUE,
  clean_spikes_and_dips = TRUE
) AS
SELECT
  facility_id,
  `timestamp` AS ts,
  congestion_level AS congestion
FROM `induspot.congestion_logs`
WHERE congestion_level IS NOT NULL;


-- =====================================================================
-- 2) ML.FORECAST 예시 — 시설별 향후 24스텝 예측 (즉석 조회)
-- =====================================================================
SELECT
  facility_id,
  forecast_timestamp,
  forecast_value,
  prediction_interval_lower_bound,
  prediction_interval_upper_bound
FROM
  ML.FORECAST(
    MODEL `induspot.congestion_forecast`,
    STRUCT(24 AS horizon, 0.9 AS confidence_level)
  )
ORDER BY facility_id, forecast_timestamp;


-- =====================================================================
-- 3) 사전계산 lookup 테이블 — 백엔드가 실시간으로 조회하는 대상
--    forecast_value 를 [0,1] 로 클리핑해 congestion 의미와 일치시킨다.
-- =====================================================================
CREATE OR REPLACE TABLE `induspot.congestion_forecast_lookup` AS
SELECT
  facility_id,
  forecast_timestamp,
  GREATEST(0.0, LEAST(1.0, forecast_value)) AS forecast_congestion,
  GREATEST(0.0, LEAST(1.0, prediction_interval_lower_bound)) AS lower_bound,
  GREATEST(0.0, LEAST(1.0, prediction_interval_upper_bound)) AS upper_bound,
  CURRENT_TIMESTAMP() AS computed_at
FROM
  ML.FORECAST(
    MODEL `induspot.congestion_forecast`,
    STRUCT(48 AS horizon, 0.9 AS confidence_level)
  );


-- =====================================================================
-- 4) lookup 조회 예시 — 특정 시설의 가장 가까운 미래 예측 1건
--    (백엔드 predict_service 의 선택적 'bqml 사전계산 조회' 경로가 사용할 형태)
-- =====================================================================
-- SELECT facility_id, forecast_timestamp, forecast_congestion
-- FROM `induspot.congestion_forecast_lookup`
-- WHERE facility_id = @facility_id
--   AND forecast_timestamp >= CURRENT_TIMESTAMP()
-- ORDER BY forecast_timestamp
-- LIMIT 1;
