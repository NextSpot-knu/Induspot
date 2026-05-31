"""WP2/WP4 인프라 프로비저닝 (일회성): BigQuery induspot 데이터셋+테이블, Pub/Sub 토픽 생성.
멱등. ADC 인증 사용."""
from google.cloud import bigquery, pubsub_v1
import google.api_core.exceptions as gex

PROJECT = "knudc-henryseo711"

# --- WP2: BigQuery dataset + table ---
bq = bigquery.Client(project=PROJECT, location="US")
ds_id = f"{PROJECT}.induspot"
try:
    bq.get_dataset(ds_id)
    print("BQ_DATASET=exists", ds_id)
except gex.NotFound:
    d = bigquery.Dataset(ds_id)
    d.location = "US"
    bq.create_dataset(d, exists_ok=True)
    print("BQ_DATASET=created", ds_id)

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

# --- WP4: Pub/Sub topic ---
pub = pubsub_v1.PublisherClient()
tp = pub.topic_path(PROJECT, "induspot-congestion")
try:
    pub.create_topic(request={"name": tp})
    print("PUBSUB_TOPIC=created", tp)
except gex.AlreadyExists:
    print("PUBSUB_TOPIC=exists", tp)

print("INFRA_OK")
