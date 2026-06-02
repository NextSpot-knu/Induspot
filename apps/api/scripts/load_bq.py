"""WP2 — Supabase `congestion_logs` → BigQuery `induspot.congestion_logs` 적재.

스키마(공유 계약과 일치 — app.core.bigquery.insert_congestion_rows / scripts/provision_bigquery.py
/ scripts/_provision_infra.py 와 동일):
  facility_id STRING, congestion_level FLOAT64, current_count INT64, source STRING, timestamp TIMESTAMP
Supabase 컬럼명과 1:1 이므로 변환 없이 매핑한다. (과거의 ts/congestion/facility_type 변형 스키마는 폐기:
세 스크립트가 같은 테이블을 서로 다른 스키마로 만들면 먼저 생성한 쪽이 고착돼 스트리밍 인서트와
BQML 학습 SELECT(timestamp/congestion_level)가 깨졌다.)

적재 모드:
  --mode full         : BQ 테이블을 비우고 전량 재적재 (기본)
  --mode incremental  : BQ의 max(timestamp) 이후 신규 로그만 추가

실행:
  cd apps/api
  poetry run python scripts/load_bq.py --mode full

사전 셋업:
  gcloud services enable bigquery.googleapis.com
  # 실행 SA 에 roles/bigquery.jobUser + roles/bigquery.dataEditor
  # 데이터셋/테이블은 없으면 본 스크립트가 생성한다(provision_bigquery.py 와 동일 계약 스키마).
"""

import os
import sys
import argparse

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(parent_dir, ".env"))

from supabase import create_client  # noqa: E402
from app.core.config import settings  # noqa: E402

TABLE_NAME = "congestion_logs"


def _bq_schema(bigquery):
    """공유 계약 스키마. 스트리밍 인서트 호환을 위해 모두 NULLABLE."""
    return [
        bigquery.SchemaField("facility_id", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("congestion_level", "FLOAT64", mode="NULLABLE"),
        bigquery.SchemaField("current_count", "INT64", mode="NULLABLE"),
        bigquery.SchemaField("source", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("timestamp", "TIMESTAMP", mode="NULLABLE"),
    ]


def ensure_dataset_and_table(client, bigquery, table_ref):
    dataset_id = f"{client.project}.{settings.BQ_DATASET}"
    try:
        client.get_dataset(dataset_id)
    except Exception:
        ds = bigquery.Dataset(dataset_id)
        ds.location = settings.BQ_LOCATION
        client.create_dataset(ds, exists_ok=True)
        print(f"Created dataset {dataset_id} ({settings.BQ_LOCATION})")

    try:
        client.get_table(table_ref)
    except Exception:
        table = bigquery.Table(table_ref, schema=_bq_schema(bigquery))
        client.create_table(table, exists_ok=True)
        print(f"Created table {table_ref}")


def fetch_supabase_logs(supabase, since_iso: str | None) -> list:
    rows = []
    limit = 1000
    start = 0
    while True:
        q = (
            supabase.table("congestion_logs")
            .select("facility_id, timestamp, congestion_level, current_count, source")
        )
        if since_iso:
            q = q.gt("timestamp", since_iso)
        res = q.order("timestamp", desc=False).range(start, start + limit - 1).execute()
        if not res.data:
            break
        rows.extend(res.data)
        if len(res.data) < limit:
            break
        start += limit
    return rows


def get_bq_max_ts(client, table_ref) -> str | None:
    try:
        query = f"SELECT MAX(`timestamp`) AS max_ts FROM `{table_ref}`"
        for row in client.query(query).result():
            if row["max_ts"] is not None:
                return row["max_ts"].isoformat()
    except Exception as e:
        print(f"max(timestamp) 조회 실패(테이블 비어있거나 신규일 수 있음): {e}")
    return None


def to_bq_rows(logs: list) -> list:
    out = []
    for log in logs:
        fid = log.get("facility_id")
        ts = log.get("timestamp")
        cong = log.get("congestion_level")
        if not fid or ts is None or cong is None:
            continue
        cnt = log.get("current_count")
        out.append({
            "facility_id": fid,
            "congestion_level": float(cong),
            "current_count": int(cnt) if cnt is not None else None,
            "source": log.get("source"),
            "timestamp": ts,
        })
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["full", "incremental"], default="full")
    args = parser.parse_args()

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        print("ERROR: SUPABASE_URL/KEY 누락.")
        sys.exit(1)

    try:
        from google.cloud import bigquery
    except ImportError:
        print("ERROR: google-cloud-bigquery 미설치. `poetry add google-cloud-bigquery` 후 재실행.")
        sys.exit(1)

    supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    client = bigquery.Client(project=settings.GCP_PROJECT_ID, location=settings.BQ_LOCATION)
    table_ref = f"{client.project}.{settings.BQ_DATASET}.{TABLE_NAME}"

    ensure_dataset_and_table(client, bigquery, table_ref)

    if args.mode == "full":
        # 전량 재적재: 기존 테이블(이전 세션의 구 스키마 ts/congestion/facility_type 일 수 있음)을 DROP 후
        # 계약 스키마로 재생성한다. TRUNCATE 는 스키마를 유지하므로 구 스키마와 계약(timestamp/congestion_level)
        # 이 충돌해 적재(400 Field ts is missing)와 BQML(Unrecognized name: congestion_level)이 깨진다.
        client.query(f"DROP TABLE IF EXISTS `{table_ref}`").result()
        client.create_table(bigquery.Table(table_ref, schema=_bq_schema(bigquery)))
        print("RECREATE TABLE (full 모드: 계약 스키마로 재생성)")

    since_iso = None
    if args.mode == "incremental":
        since_iso = get_bq_max_ts(client, table_ref)
        print(f"Incremental 모드: timestamp > {since_iso} 인 로그만 적재")

    print("Fetching congestion logs from Supabase...")
    logs = fetch_supabase_logs(supabase, since_iso)
    print(f"  {len(logs)} logs")

    rows = to_bq_rows(logs)
    if not rows:
        print("적재할 행이 없습니다. 종료.")
        return

    # load_table_from_json: WRITE_APPEND (full 모드는 위에서 DROP+재생성한 빈 테이블에, incremental 은 기존 테이블에 append)
    job_config = bigquery.LoadJobConfig(
        schema=_bq_schema(bigquery),
        write_disposition="WRITE_APPEND",
    )
    job = client.load_table_from_json(rows, table_ref, job_config=job_config)
    job.result()
    table = client.get_table(table_ref)
    print(f"적재 완료: {len(rows)}행 추가 → {table_ref} (총 {table.num_rows}행)")


if __name__ == "__main__":
    main()
