"""WP2 — BQML 예보 갱신 실행기 (refresh_forecast.sql 을 BigQuery 스크립트로 제출).

왜 별도 실행기인가: PowerShell 5.1 에서 `Get-Content ... | bq query` 는 파이프를 레거시 코드페이지(CP949)로
재인코딩해 SQL 바이트를 깨뜨린다("Illegal input character"). SQL 파일을 UTF-8 로 직접 읽어
google-cloud-bigquery 클라이언트로 멀티스테이트먼트 스크립트를 제출하면 셸 인코딩을 완전히 우회한다(ADC 인증).

실행:
  cd apps/api
  .venv\\Scripts\\python.exe scripts\\refresh_forecast.py

성공 시 "BQML_OK" 와 future_rows>0(=/api/v1/forecast 가 source=bqml 로 라이브) 을 출력한다.
이 스크립트(또는 refresh_forecast.sql)를 BigQuery 스케줄드 쿼리로 12시간마다 돌리면 예보가 만료되지 않는다.
"""

import os
import sys

from google.cloud import bigquery

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
SQL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refresh_forecast.sql")


def main() -> int:
    with open(SQL_PATH, "r", encoding="utf-8") as f:
        script = f.read()

    client = bigquery.Client(project=PROJECT, location=LOCATION)
    print(f"Submitting BQML refresh script ({len(script)} chars) to {PROJECT} @ {LOCATION} ...")
    # client.query 는 멀티스테이트먼트 BigQuery 스크립트(모델 재학습 + lookup 재생성)를 한 잡으로 실행한다.
    client.query(script).result()  # 완료까지 대기(실패 시 예외)
    print("Script completed. Verifying lookup ...")

    verify = client.query(
        f"""
        SELECT
          COUNT(*) AS n,
          COUNT(DISTINCT facility_id) AS facilities,
          MIN(forecast_timestamp) AS min_ft,
          MAX(forecast_timestamp) AS max_ft,
          COUNTIF(forecast_timestamp >= CURRENT_TIMESTAMP()) AS future_rows
        FROM `{PROJECT}.induspot.congestion_forecast_lookup`
        """
    ).result()

    ok = False
    for r in verify:
        print(
            f"  lookup rows={r['n']} facilities={r['facilities']} "
            f"min_ft={r['min_ft']} max_ft={r['max_ft']} future_rows={r['future_rows']}"
        )
        ok = bool(r["future_rows"] and r["future_rows"] > 0)

    if ok:
        print("BQML_OK")
        return 0
    print("BQML_WARN: no future rows (forecast horizon may be in the past — check data freshness)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
