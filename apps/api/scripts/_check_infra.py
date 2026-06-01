"""읽기 전용: BQ 데이터셋/테이블/모델 + Pub/Sub 토픽/구독 현재 상태 조회. 아무것도 생성하지 않음."""
from google.cloud import bigquery, pubsub_v1
import google.api_core.exceptions as gex

P = "knudc-henryseo711"

bq = bigquery.Client(project=P)
print("DATASETS:", [d.dataset_id for d in bq.list_datasets()])
try:
    t = bq.get_table(f"{P}.induspot.congestion_logs")
    print("TABLE congestion_logs rows=", t.num_rows)
except gex.NotFound:
    print("TABLE congestion_logs: NONE")
try:
    m = bq.get_model(f"{P}.induspot.congestion_forecast")
    print("MODEL congestion_forecast:", m.model_type)
except Exception:
    print("MODEL congestion_forecast: NONE")

pub = pubsub_v1.PublisherClient()
print("TOPICS:", [t.name.split("/")[-1] for t in pub.list_topics(request={"project": f"projects/{P}"})])
sub = pubsub_v1.SubscriberClient()
print("SUBS:", [s.name.split("/")[-1] for s in sub.list_subscriptions(request={"project": f"projects/{P}"})])
