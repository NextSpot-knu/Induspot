-- WP2 -- BQML forecast refresh (retrain ARIMA_PLUS + rebuild the lookup table).
--
-- Why: congestion_forecast_lookup holds precomputed forecasts keyed by forecast_timestamp.
--   /api/v1/forecast/* only returns rows where forecast_timestamp >= CURRENT_TIMESTAMP(), so once the
--   precomputed horizon slides into the past the endpoint degrades to source=unavailable. Run this
--   periodically (BigQuery scheduled query, every ~12h) so the lookup always contains a live future horizon.
--   The model is retrained on the latest streaming congestion_logs data each time.
--
-- Run (ASCII-only on purpose so `Get-Content -Raw | bq query` is encoding-safe on any console codepage):
--   Get-Content apps/api/scripts/refresh_forecast.sql -Raw | bq --location=us-central1 query --use_legacy_sql=false
--   (or register as a BigQuery scheduled query -- see docs/GCP_NATIVE_DEPLOY_RUNBOOK.md)

CREATE OR REPLACE MODEL `knudc-henryseo711.induspot.congestion_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'congestion',
  time_series_id_col = 'facility_id',
  data_frequency = 'HOURLY',
  auto_arima = TRUE,
  decompose_time_series = TRUE,
  clean_spikes_and_dips = TRUE
) AS
-- Aggregate the 10-min streaming logs to a clean HOURLY grid per facility. This dedupes exact-duplicate
-- (facility_id, timestamp) rows and removes the sub-minute jitter (seconds drift like :13/:14/:16) so
-- ARIMA_PLUS sees a regular hourly series. Raw jittered timestamps make the model fail with
-- "All time series failed to fit" under AUTO_FREQUENCY.
SELECT facility_id, TIMESTAMP_TRUNC(`timestamp`, HOUR) AS ts, AVG(congestion_level) AS congestion
FROM `knudc-henryseo711.induspot.congestion_logs`
WHERE congestion_level IS NOT NULL AND `timestamp` IS NOT NULL
GROUP BY facility_id, ts;

CREATE OR REPLACE TABLE `knudc-henryseo711.induspot.congestion_forecast_lookup` AS
SELECT
  facility_id,
  forecast_timestamp,
  GREATEST(0.0, LEAST(1.0, forecast_value)) AS forecast_congestion,
  GREATEST(0.0, LEAST(1.0, prediction_interval_lower_bound)) AS lower_bound,
  GREATEST(0.0, LEAST(1.0, prediction_interval_upper_bound)) AS upper_bound,
  CURRENT_TIMESTAMP() AS computed_at
FROM ML.FORECAST(
  MODEL `knudc-henryseo711.induspot.congestion_forecast`,
  STRUCT(48 AS horizon, 0.9 AS confidence_level)
);
