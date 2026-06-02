"""[Tier2 / WP5] Dataflow 잡 런처 — congestion_pipeline 을 DataflowRunner 로 띄운다.

이 스크립트는 congestion_pipeline.run() 에 DataflowRunner 옵션을 주입하는 얇은 래퍼다.
파이프라인 로직(파싱·윈도우·집계)은 congestion_pipeline.build_pipeline 에 그대로 두고,
여기서는 "어디에/어떤 권한으로/얼마나 영속적으로" 실행할지(런타임 결선)만 책임진다.

전제(이미 프로비저닝됨 — 이 스크립트는 GCP 를 만들지 않는다):
  - Pub/Sub 구독:  induspot-congestion-push  (토픽 induspot-congestion)
  - BigQuery:      induspot.congestion_windowed  (없으면 WriteToBigQuery 가 CREATE_IF_NEEDED 로 생성)
  - GCS temp/staging: gs://induspot-models-6757/dataflow-temp, .../dataflow-staging
  - 런타임 SA:     768699236852-compute@developer.gserviceaccount.com

실행(로컬 머신, gcloud auth 필요 — 자동으로 ADC 사용):
  # 전용 venv 로 실행(beam 은 Cloud Run 이미지에 없음)
  apps\\api\\.venv_beam\\Scripts\\python apps\\api\\dataflow\\launch_dataflow.py
  # 또는 (이미 떠 있는 영속 스트리밍 잡을 무중단 갱신):
  apps\\api\\.venv_beam\\Scripts\\python apps\\api\\dataflow\\launch_dataflow.py --update

멱등성(idempotency):
  - 영속 스트리밍 잡 이름은 항상 induspot-congestion-windowing 로 고정한다.
  - 같은 이름의 잡이 이미 RUNNING 이면 새로 띄우지 말고 --update 로 재실행한다
    (Dataflow drain-and-replace; 코드/그래프 변경을 무중단 반영).
  - 잡이 없을 때 --update 를 주면 Dataflow 가 에러를 내므로, 최초 1회는 --update 없이 실행한다.
  - 비용 주의: 스트리밍 잡은 워커가 상시 떠 있어 과금된다(아래 README.md 의 비용 메모 참조).
    데모 후에는 'gcloud dataflow jobs cancel' 로 반드시 종료할 것.
"""

import argparse
import sys

# 프로젝트 사실(verbatim) — congestion_pipeline 의 DEFAULT_* 과 일치시킨다.
PROJECT = "knudc-henryseo711"
REGION = "us-central1"
TEMP_LOCATION = "gs://induspot-models-6757/dataflow-temp"
STAGING_LOCATION = "gs://induspot-models-6757/dataflow-staging"
SERVICE_ACCOUNT_EMAIL = "768699236852-compute@developer.gserviceaccount.com"
SUBSCRIPTION = "projects/knudc-henryseo711/subscriptions/induspot-congestion-push"
BQ_TABLE = "knudc-henryseo711:induspot.congestion_windowed"

# 영속 스트리밍 잡 이름(고정 → 멱등 재실행/--update 의 키).
JOB_NAME = "induspot-congestion-windowing"


def build_argv(update: bool) -> list:
    """congestion_pipeline.run() 에 전달할 argv 를 조립한다(DataflowRunner 결선)."""
    argv = [
        f"--project={PROJECT}",
        f"--subscription={SUBSCRIPTION}",
        f"--bq_table={BQ_TABLE}",
        # --- Dataflow / GoogleCloudOptions (pipeline_args 로 흘러간다) ---
        "--runner=DataflowRunner",
        f"--region={REGION}",
        f"--temp_location={TEMP_LOCATION}",
        f"--staging_location={STAGING_LOCATION}",
        f"--service_account_email={SERVICE_ACCOUNT_EMAIL}",
        f"--job_name={JOB_NAME}",
        "--streaming",
        # 워커 자동 확장 상한(데모 비용 억제). 필요 시 조정.
        "--max_num_workers=2",
    ]
    if update:
        # 같은 이름의 RUNNING 잡을 무중단 갱신(drain-and-replace).
        argv.append("--update")
    return argv


def main(cli_argv=None):
    parser = argparse.ArgumentParser(description="Launch the InduSpot congestion windowing Dataflow streaming job.")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Update the already-running persistent streaming job in place (idempotent re-launch).",
    )
    args = parser.parse_args(cli_argv)

    # 지연 임포트: apache-beam(전용 venv)에서만 import 되도록 하여, 잘못된 인터프리터로
    # 실행했을 때 명확한 에러를 남긴다. congestion_pipeline 은 같은 디렉터리(dataflow 패키지)다.
    try:
        from dataflow.congestion_pipeline import run as run_pipeline
    except ModuleNotFoundError:
        # 패키지 컨텍스트(-m)가 아닌 직접 실행도 지원.
        from congestion_pipeline import run as run_pipeline  # type: ignore

    argv = build_argv(update=args.update)
    print("[launch_dataflow] submitting Dataflow job", JOB_NAME, "(update=%s)" % args.update)
    print("[launch_dataflow] argv:", " ".join(argv))
    run_pipeline(argv)
    print("[launch_dataflow] SUCCESS: Dataflow job submission returned (check the Dataflow console for RUNNING state).")


if __name__ == "__main__":
    sys.exit(main())
