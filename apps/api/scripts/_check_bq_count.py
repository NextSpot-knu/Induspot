"""congestion_logs 행수/최신 타임스탬프 빠른 확인.

용도: load_bq(Supabase->BQ) 적재 + Pub/Sub push 듀얼라이트가 BigQuery 까지 도달했는지 검증.
  - load_bq 직후 기준선(예: 3676행)과 비교해 늘어났으면 push->/ingest->BQ 듀얼라이트 성공.
  - COUNT(*) 는 스트리밍 버퍼까지 읽으므로 방금 들어온 행도 보인다(get_table.num_rows 는 지연될 수 있음).

실행(apps/api 에서):
  .venv\\Scripts\\python.exe scripts\\_check_bq_count.py

인증: 로컬 ADC 가 BigQuery 권한이 없으면(403) 프로젝트 SA 키로 폴백한다(그 SA 에 dataEditor+jobUser 부여됨).
파일이라 셸 escaping(백틱) 문제가 없다.
"""

import os

from google.cloud import bigquery

PROJECT = "knudc-henryseo711"
TABLE = "knudc-henryseo711.induspot.congestion_logs"
# deploy.ps1 의 -SaKey 기본값과 동일(BigQuery dataEditor+jobUser 보유). 없으면 ambient ADC 사용.
SA_KEY = r"C:\Users\samsung-user\Desktop\Google_Challenge\knudc-henryseo711-775e5ed806b7.json"


def _client() -> bigquery.Client:
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") and os.path.exists(SA_KEY):
        return bigquery.Client.from_service_account_json(SA_KEY, project=PROJECT)
    return bigquery.Client(project=PROJECT)


def main() -> None:
    client = _client()
    sql = (
        "SELECT COUNT(*) AS n, MAX(`timestamp`) AS latest, "
        "COUNT(DISTINCT facility_id) AS facilities "
        f"FROM `{TABLE}`"
    )
    for row in client.query(sql).result():
        print(
            f"congestion_logs rows={row['n']} | facilities={row['facilities']} | latest={row['latest']}"
        )


if __name__ == "__main__":
    main()
