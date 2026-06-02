"""[Tier2] Cloud Run Job(퍼블리셔) + Cloud Scheduler(크론) 배포. 멱등.

WP4 수집 백본을 '관리형'으로: 수동 scratch/publish_events.py 대신, Cloud Scheduler 가
주기적으로 Cloud Run Job(`app.jobs.publish_congestion`)을 실행해 Pub/Sub 로 점유 이벤트를
발행한다. → push 구독 → /ingest/pubsub → congestion_logs 실시간 갱신.

Job 은 induspot-api 와 **동일 이미지를 재사용**하고 명령만 바꿔 실행한다(별도 Dockerfile 불필요).

실행:
  cd apps/api && python scripts/deploy_publisher_job.py
  # 파라미터 오버라이드:
  python scripts/deploy_publisher_job.py --region asia-northeast3 --topic induspot-congestion --schedule "*/10 * * * *"

사전:
  - induspot-api 가 한 번 이상 배포돼 있어야 한다(이미지 URI 를 거기서 가져온다).
  - Job 이 Supabase facilities 를 읽으므로 자격이 필요하다. Secret Manager(#7, setup_secrets.py)
    가 준비됐다면 --set-secrets 가 동작하고, 아니라면 SUPABASE_* 를 --set-env-vars 로 주입하라.

멱등: Job/Scheduler 모두 describe 후 create-or-update 로 재실행 안전. 완료 시 PUBLISHER_JOB_OK 출력.
"""

import argparse
import subprocess
import sys

from _gcloud import GCLOUD  # gcloud.cmd 전체 경로(Windows WinError 2 회피)

# 기본값(상수). argv 로 오버라이드 가능.
PROJECT = "knudc-henryseo711"
REGION = "asia-northeast3"          # Cloud Run(잡)·Scheduler 리전(백엔드와 통일)
API_SERVICE = "induspot-api"        # 이미지 출처(동일 이미지 재사용)
JOB = "induspot-publisher"
SCHED = "induspot-publisher-cron"
SCHEDULE = "*/10 * * * *"           # 10분마다(필요시 조정)
TOPIC = "induspot-congestion"
SA = "768699236852-compute@developer.gserviceaccount.com"  # 잡 실행/스케줄러 호출 SA(editor 보유)


def run_cmd(cmd, check=False):
    print("\n$", " ".join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        msg = "gcloud not found on PATH."
        if check:
            sys.exit(f"명령 실패: {msg} 중단합니다.")
        print("   ", msg)
        return False
    if r.stdout:
        print(r.stdout.strip())
    if r.returncode != 0:
        if r.stderr:
            print(r.stderr.strip())
        if check:
            sys.exit(f"명령 실패(exit {r.returncode}). 중단합니다.")
        return False
    return True


def get_api_image(cfg) -> str:
    try:
        r = subprocess.run(
            [GCLOUD, "run", "services", "describe", cfg.api_service,
             f"--region={cfg.region}", f"--project={cfg.project}",
             "--format=value(spec.template.spec.containers[0].image)"],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def deploy(cfg) -> None:
    print("=== 1. 필요한 서비스 활성화 ===")
    for svc in ("run.googleapis.com", "cloudscheduler.googleapis.com", "pubsub.googleapis.com"):
        run_cmd([GCLOUD, "services", "enable", svc, f"--project={cfg.project}"], check=True)

    image = get_api_image(cfg)
    if not image:
        sys.exit(f"Error: {cfg.api_service} 이미지 URI 를 가져오지 못했습니다. 먼저 백엔드를 배포하세요.")
    print(f"재사용 이미지: {image}")

    print(f"\n=== 2. Cloud Run Job 배포({cfg.job}) ===")
    # 동일 이미지 + 명령만 교체(run-to-completion). `jobs deploy` 는 없으면 생성/있으면 갱신(멱등).
    # Supabase 자격은 Secret Manager 권장.
    run_cmd([
        GCLOUD, "run", "jobs", "deploy", cfg.job,
        f"--image={image}", f"--region={cfg.region}", f"--project={cfg.project}",
        f"--service-account={cfg.sa}",
        "--command=python",
        "--args=-m,app.jobs.publish_congestion",
        f"--set-env-vars=GCP_PROJECT_ID={cfg.project},PUBSUB_TOPIC={cfg.topic}",
        # Secret Manager(#7) 준비 시:
        "--set-secrets=SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest",
        "--max-retries=1",
    ], check=True)

    print("\n=== 3. Cloud Scheduler 크론 → Job 실행 ===")
    uri = (f"https://{cfg.region}-run.googleapis.com/apis/run.googleapis.com/v1/"
           f"namespaces/{cfg.project}/jobs/{cfg.job}:run")
    exists = run_cmd([GCLOUD, "scheduler", "jobs", "describe", cfg.sched,
                      f"--location={cfg.region}", f"--project={cfg.project}"])
    base = [
        f"--location={cfg.region}", f"--project={cfg.project}",
        f"--schedule={cfg.schedule}", "--http-method=POST", f"--uri={uri}",
        f"--oauth-service-account-email={cfg.sa}",
    ]
    if exists:
        run_cmd([GCLOUD, "scheduler", "jobs", "update", "http", cfg.sched] + base)
    else:
        run_cmd([GCLOUD, "scheduler", "jobs", "create", "http", cfg.sched] + base, check=True)

    print("\n=== 완료 ===")
    print(f"수동 1회 실행 테스트: gcloud run jobs execute {cfg.job} --region={cfg.region} --project={cfg.project}")
    print(f"스케줄: {cfg.schedule} (KST 무관 UTC 기준 cron — 필요시 --schedule 조정)")
    print("주의: Secret Manager(#7) 미설정이면 --set-secrets 줄을 빼고 SUPABASE_* 를 --set-env-vars 로 주입.")
    print("PUBLISHER_JOB_OK")


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="induspot 퍼블리셔 Cloud Run Job + Scheduler 배포(멱등)")
    ap.add_argument("--project", default=PROJECT)
    ap.add_argument("--region", default=REGION)
    ap.add_argument("--api-service", dest="api_service", default=API_SERVICE)
    ap.add_argument("--job", default=JOB)
    ap.add_argument("--sched", default=SCHED)
    ap.add_argument("--schedule", default=SCHEDULE)
    ap.add_argument("--topic", default=TOPIC)
    ap.add_argument("--sa", default=SA)
    return ap.parse_args(argv)


if __name__ == "__main__":
    deploy(parse_args())
