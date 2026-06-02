"""[WP4] Pub/Sub 수집 백본 단일 프로비저닝 엔트리포인트 (멱등).

한 번의 실행으로 GCP-native 점유 수집 파이프라인 전체를 준비한다:

  1) 토픽 get-or-create            : induspot-congestion
  2) push 구독 get-or-create        : induspot-congestion-push
                                      → Cloud Run /ingest/pubsub 로 OIDC push
  3) push SA 에 run.invoker 부여     : push 요청이 Cloud Run 을 호출할 수 있도록(1차 IAM 방어)
  4) 퍼블리셔 Cloud Run Job + Scheduler 배포
                                      : */10 크론으로 publish_congestion 실행

(1)~(3) 은 scripts/_provision_infra.provision_pubsub() 에 위임하고,
(4) 는 scripts/deploy_publisher_job.deploy() 에 위임한다(로직 중복 방지).

가드레일: 클라우드 변경 명령이라 auto 분류기가 막을 수 있다 — 그 경우 사용자가 직접 실행하거나
동등한 gcloud/bq 명령을 사용한다(README 참고). 모든 단계는 재실행 안전(멱등)하다.

실행:
  cd apps/api && python scripts/provision_pubsub.py
  # 파라미터 오버라이드(퍼블리셔 잡/스케줄):
  python scripts/provision_pubsub.py --region asia-northeast3 --schedule "*/10 * * * *"

완료 시 PUBSUB_PROVISION_OK 를 출력한다.
"""

import argparse
import sys

# 동일 패키지(scripts) 의 두 모듈에 위임. 직접 실행/`python -m` 양쪽을 지원하도록 임포트를 폴백한다.
try:
    from scripts import _provision_infra, deploy_publisher_job
except ImportError:  # `cd apps/api && python scripts/provision_pubsub.py` 경로
    import _provision_infra
    import deploy_publisher_job


def main(argv=None) -> int:
    args = _parse_args(argv)

    print("=== [1/2] 토픽 + push 구독 + run.invoker (멱등) ===")
    # _provision_infra.provision_pubsub() 가 토픽 get-or-create → push 구독 get-or-create
    # (OIDC push to /ingest/pubsub) → push SA 에 run.invoker 부여까지 모두 수행한다.
    _provision_infra.provision_pubsub()

    print("\n=== [2/2] 퍼블리셔 Cloud Run Job + Scheduler 배포 (멱등) ===")
    # deploy_publisher_job 의 기본 상수를 그대로 쓰되, argv 오버라이드를 전달한다.
    job_cfg = deploy_publisher_job.parse_args([
        "--project", args.project,
        "--region", args.region,
        "--schedule", args.schedule,
        "--topic", args.topic,
        "--sa", args.sa,
    ])
    deploy_publisher_job.deploy(job_cfg)

    print("\nPUBSUB_PROVISION_OK")
    return 0


def _parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="InduSpot Pub/Sub 수집 백본 전체 프로비저닝(멱등)")
    ap.add_argument("--project", default=_provision_infra.PROJECT)
    ap.add_argument("--region", default=deploy_publisher_job.REGION,
                    help="퍼블리셔 Cloud Run Job/Scheduler 리전(백엔드와 통일)")
    ap.add_argument("--schedule", default=deploy_publisher_job.SCHEDULE)
    ap.add_argument("--topic", default=_provision_infra.TOPIC)
    ap.add_argument("--sa", default=deploy_publisher_job.SA)
    return ap.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
