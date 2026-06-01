"""WP2 — Supabase `congestion_logs` → BigQuery `induspot.congestion_logs` 적재.

스키마 매핑(중요): Supabase 실제 컬럼명과 BQ 목표 스키마가 다르다.
  Supabase: facility_id, timestamp,          current_count, congestion_level, source
  BigQuery: facility_id, ts(TIMESTAMP),       (드롭),         congestion(FLOAT64), source
  + facilities 조인으로 facility_type(병합 규칙 적용) 추가.

BQ 테이블 스키마:
  facility_id STRING, facility_type STRING, ts TIMESTAMP, congestion FLOAT64, source STRING

적재 모드:
  --mode full         : BQ 테이블을 비우고 전량 재적재 (기본)
  --mode incremental  : BQ의 max(ts) 이후 신규 로그만 추가

실행:
  cd apps/api
  poetry run python scripts/load_bq.py --mode full

사전 셋업:
  gcloud services enable bigquery.googleapis.com
  # SA 에 roles/bigquery.jobUser + roles/bigquery.dataEditor
  # 데이터셋은 본 스크립트가 없으면 생성한다(리전 = settings.BQ_LOCATION).
"""

import os
import sys
import argparse
from datetime import datetime

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(parent_dir, ".env"))

from supabase import create_client  # noqa: E402
from app.core.config import settings  # noqa: E402

TABLE_NAME = "congestion_logs"


def normalize_facility_type(facility_type: str) -> str:
    if facility_type in ["restaurant", "cafe"]:
        return "cafeteria"
    elif facility_type == "gym":
        return "loading_dock"
    elif facility_type == "office":
        return "meeting_room"
    elif facility_type in ["cafeteria", "parking", "meeting_room", "loading_dock"]:
        return facility_type
    return facility_type


def _bq_schema(bigquery):
    return [
        bigquery.SchemaField("facility_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("facility_type", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("congestion", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("source", "STRING", mode="NULLABLE"),
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


def fetch_facility_types(supabase) -> dict:
    res = supabase.table("facilities").select("id, type").execute()
    return {f["id"]: normalize_facility_type(f["type"]) for f in (res.data or [])}


def fetch_supabase_logs(supabase, since_iso: str | None) -> list:
    rows = []
    limit = 1000
    start = 0
    while True:
        q = (
            supabase.table("congestion_logs")
            .select("facility_id, timestamp, congestion_level, source")
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
        query = f"SELECT MAX(ts) AS max_ts FROM `{table_ref}`"
        for row in client.query(query).result():
            if row["max_ts"] is not None:
                return row["max_ts"].isoformat()
    except Exception as e:
        print(f"max(ts) 조회 실패(테이블 비어있거나 신규일 수 있음): {e}")
    return None


def to_bq_rows(logs: list, facility_types: dict) -> list:
    out = []
    for log in logs:
        fid = log.get("facility_id")
        ts = log.get("timestamp")
        cong = log.get("congestion_level")
        if not fid or ts is None or cong is None:
            continue
        out.append({
            "facility_id": fid,
            "facility_type": facility_types.get(fid),
            "ts": ts,
            "congestion": float(cong),
            "source": log.get("source"),
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

    since_iso = None
    if args.mode == "incremental":
        since_iso = get_bq_max_ts(client, table_ref)
        print(f"Incremental 모드: ts > {since_iso} 인 로그만 적재")

    print("Fetching facility types...")
    facility_types = fetch_facility_types(supabase)
    print(f"  {len(facility_types)} facilities")

    print("Fetching congestion logs from Supabase...")
    logs = fetch_supabase_logs(supabase, since_iso)
    print(f"  {len(logs)} logs")

    rows = to_bq_rows(logs, facility_types)
    if not rows:
        print("적재할 행이 없습니다. 종료.")
        return

    if args.mode == "full":
        # 전량 재적재: 테이블 truncate 후 적재
        client.query(f"TRUNCATE TABLE `{table_ref}`").result()
        print("TRUNCATE 완료 (full 모드)")

    # load_table_from_json: WRITE_APPEND
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
