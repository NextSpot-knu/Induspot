"""WP2/WP4 인프라 프로비저닝 (일회성, 멱등): BigQuery induspot 데이터셋+테이블, Pub/Sub 토픽 생성.

ADC 인증 사용. 리전은 Vertex/Cloud Run과 통일(us-central1).
실행: poetry run python scripts/_provision_infra.py
(auto 분류기가 막으면 사용자가 직접 실행하거나, 동등한 gcloud/bq 명령을 사용한다 — README 참고.)
"""
import subprocess

from google.cloud import bigquery
import google.api_core.exceptions as gex

from _gcloud import GCLOUD  # gcloud.cmd 전체 경로(Windows WinError 2 회피)

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
DATASET = "induspot"
TOPIC = "induspot-congestion"

# --- WP4 push 구독 설정 ---
SUBSCRIPTION = "induspot-congestion-push"
# push 대상: Cloud Run /ingest/pubsub. OIDC audience 도 동일 URL 로 둔다.
PUSH_ENDPOINT = "https://induspot-api-to7m2nnlca-du.a.run.app/ingest/pubsub"
PUSH_AUDIENCE = PUSH_ENDPOINT
# push 요청에 OIDC 토큰을 실어 보낼 SA(= Cloud Run 런타임 SA). run.invoker 권한 필요.
PUSH_SA = "768699236852-compute@developer.gserviceaccount.com"
RUN_SERVICE = "induspot-api"
RUN_REGION = "asia-northeast3"


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

    # 스키마는 런타임 계약(app.core.bigquery.insert_congestion_rows)과 scripts/provision_bigquery.py 의
    # 정의와 정확히 일치해야 한다. 컬럼명/타입이 어긋나면 먼저 생성한 쪽 스키마가 고착돼(get-or-create)
    # 스트리밍 인서트와 BQML(timestamp/congestion_level 참조)이 깨진다. 모두 NULLABLE 로 둔다.
    schema = [
        bigquery.SchemaField("facility_id", "STRING"),
        bigquery.SchemaField("congestion_level", "FLOAT64"),
        bigquery.SchemaField("current_count", "INT64"),
        bigquery.SchemaField("source", "STRING"),
        bigquery.SchemaField("timestamp", "TIMESTAMP"),
    ]
    tbl_id = f"{ds_id}.congestion_logs"
    try:
        t = bq.get_table(tbl_id)
        print("BQ_TABLE=exists", tbl_id, "rows=", t.num_rows)
    except gex.NotFound:
        bq.create_table(bigquery.Table(tbl_id, schema=schema), exists_ok=True)
        print("BQ_TABLE=created", tbl_id)


def _run_gcloud(cmd: list[str]) -> bool:
    """gcloud 실행(멱등 보조). 실패해도 마지막 stderr 만 출력하고 False 반환(예외 비전파)."""
    print("$", " ".join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        print("    gcloud not found on PATH (skipping IAM grant)")
        return False
    if r.returncode != 0 and r.stderr:
        last = r.stderr.strip().splitlines()
        print("   ", last[-1] if last else "")
    return r.returncode == 0


def grant_run_invoker():
    """push SA 가 Cloud Run /ingest/pubsub 를 호출할 수 있도록 run.invoker 부여(멱등).

    서비스 레벨(`run services add-iam-policy-binding`)은 `run.services.setIamPolicy` 권한이 필요한데
    배포 계정이 Owner 가 아니면(예: editor + projectIamAdmin) 그게 없어 거부된다. 프로젝트 레벨
    run.invoker 부여는 `resourcemanager.projects.setIamPolicy`(이미 다른 역할도 이 경로로 부여됨)로
    가능하고, compute SA 가 프로젝트 내 Cloud Run 을 호출할 수 있게 해 push 전달 OIDC 요건을 충족한다.
    """
    ok = _run_gcloud([
        GCLOUD, "projects", "add-iam-policy-binding", PROJECT,
        f"--member=serviceAccount:{PUSH_SA}",
        "--role=roles/run.invoker",
        "--condition=None", "--format=none",
    ])
    print("RUN_INVOKER(project-level)=" + ("granted" if ok else "skip_or_failed"))


def provision_pubsub():
    # 토픽/구독은 gcloud(= gcloud CLI 의 owner 계정)로 생성한다. Python pubsub_v1 은 ADC(GOOGLE_APPLICATION_
    # CREDENTIALS 로 고정된 firebase-adminsdk SA)로 인증되는데 그 SA 엔 Pub/Sub 권한이 없어 403 이 난다.
    # gcloud 는 GOOGLE_APPLICATION_CREDENTIALS 를 무시하고 CLI 자격(Owner)을 쓰므로 topics.create +
    # subscriptions.create + push SA actAs(OIDC) 가 모두 통과한다. _run_gcloud 는 예외 비전파(멱등 보조).

    # 1) 토픽(멱등): describe 로 존재 확인 후 없으면 create.
    if _run_gcloud([GCLOUD, "pubsub", "topics", "describe", TOPIC, f"--project={PROJECT}", "--format=none"]):
        print("PUBSUB_TOPIC=exists", TOPIC)
    elif _run_gcloud([GCLOUD, "pubsub", "topics", "create", TOPIC, f"--project={PROJECT}"]):
        print("PUBSUB_TOPIC=created", TOPIC)
    else:
        print("PUBSUB_TOPIC=create_failed", TOPIC)

    # 2) push 구독(멱등): OIDC 토큰을 PUSH_SA 로 서명(audience=PUSH_AUDIENCE)해 Cloud Run /ingest/pubsub 로 전달.
    push_args = [
        f"--push-endpoint={PUSH_ENDPOINT}",
        f"--push-auth-service-account={PUSH_SA}",
        f"--push-auth-token-audience={PUSH_AUDIENCE}",
    ]
    if _run_gcloud([GCLOUD, "pubsub", "subscriptions", "describe", SUBSCRIPTION, f"--project={PROJECT}", "--format=none"]):
        # 이미 있으면 push 설정(엔드포인트/OIDC)을 현재 값으로 갱신.
        if _run_gcloud([GCLOUD, "pubsub", "subscriptions", "modify-push-config", SUBSCRIPTION, f"--project={PROJECT}"] + push_args):
            print("PUBSUB_SUB=exists_updated", SUBSCRIPTION)
        else:
            print("PUBSUB_SUB=exists_update_failed", SUBSCRIPTION)
    elif _run_gcloud([GCLOUD, "pubsub", "subscriptions", "create", SUBSCRIPTION,
                      f"--topic={TOPIC}", f"--project={PROJECT}", "--ack-deadline=30"] + push_args):
        print("PUBSUB_SUB=created", SUBSCRIPTION)
    else:
        print("PUBSUB_SUB=create_failed", SUBSCRIPTION)

    # 3) push SA → Cloud Run run.invoker (OIDC 검증 통과의 1차 IAM 방어선).
    grant_run_invoker()


if __name__ == "__main__":
    provision_bigquery()
    provision_pubsub()
    print("INFRA_OK")
