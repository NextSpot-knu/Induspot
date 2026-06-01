"""WP2/WP4 인프라 프로비저닝 (일회성, 멱등): BigQuery induspot 데이터셋+테이블, Pub/Sub 토픽 생성.

ADC 인증 사용. 리전은 Vertex/Cloud Run과 통일(us-central1).
실행: poetry run python scripts/_provision_infra.py
(auto 분류기가 막으면 사용자가 직접 실행하거나, 동등한 gcloud/bq 명령을 사용한다 — README 참고.)
"""
from google.cloud import bigquery, pubsub_v1
import google.api_core.exceptions as gex

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
DATASET = "induspot"
TOPIC = "induspot-congestion"


def provision_bigquery():
    bq = bigquery.Client(project=PROJECT, location=LOCATION)
    ds_id = f"{PROJECT}.{DATASET}"
    try:
        bq.get_dataset(ds_id)
        print("BQ_DATASET=exists", ds_id)
    except gex.NotFound:
        d = bigquery.Dataset(ds_id)
        d.location = LOCATION
        bq.create_dataset(d, exists_ok=True)
        print("BQ_DATASET=created", ds_id, LOCATION)

    schema = [
        bigquery.SchemaField("facility_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("facility_type", "STRING"),
        bigquery.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("congestion", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("source", "STRING"),
    ]
    tbl_id = f"{ds_id}.congestion_logs"
    try:
        t = bq.get_table(tbl_id)
        print("BQ_TABLE=exists", tbl_id, "rows=", t.num_rows)
    except gex.NotFound:
        bq.create_table(bigquery.Table(tbl_id, schema=schema), exists_ok=True)
        print("BQ_TABLE=created", tbl_id)


def provision_pubsub():
    pub = pubsub_v1.PublisherClient()
    tp = pub.topic_path(PROJECT, TOPIC)
    try:
        pub.create_topic(request={"name": tp})
        print("PUBSUB_TOPIC=created", tp)
    except gex.AlreadyExists:
        print("PUBSUB_TOPIC=exists", tp)


if __name__ == "__main__":
    provision_bigquery()
    provision_pubsub()
    print("INFRA_OK")
