"""GCP API Gateway 배포/업데이트 스크립트 (멱등).

브라우저(Firebase 정적 호스팅) → API Gateway → Cloud Run(induspot-api) 경로를 구성한다.
`openapi-gateway.yaml` 을 기반으로 API / API Config / Gateway 를 생성하거나 업데이트한다.

핵심 설계:
  - 게이트웨이는 JWT 를 검증하지 않고, openapi-gateway.yaml 의 `disable_auth: true` 로
    클라이언트의 Authorization(Supabase JWT)을 백엔드(Cloud Run)에 그대로 전달한다.
  - 따라서 Cloud Run `induspot-api` 는 allow-unauthenticated 여야 한다(아래 안내 출력).
  - API Config 는 같은 이름으로 재생성이 불가하므로, 실행할 때마다 타임스탬프 기반의
    새 CONFIG_ID 를 만들어 Gateway 를 그 버전으로 업데이트한다(멱등 재배포).

실행:
  cd apps/api && poetry run python scripts/deploy_gateway.py
"""

import os
import subprocess
import sys
from datetime import datetime

PROJECT = "knudc-henryseo711"
API_ID = "induspot-gateway-api"
GATEWAY_ID = "induspot-gateway"
# API Gateway 가용 리전(서울 asia-northeast3 미지원). 백엔드(Cloud Run)는 asia-northeast3 라도
# 게이트웨이는 us-central1 에 두고 교차 리전으로 호출한다(yaml 의 backend address 참조).
REGION = "us-central1"
YAML_PATH = "openapi-gateway.yaml"
# 게이트웨이가 비공개(IAM) Cloud Run 을 호출할 때 쓰는 backend-auth 서비스계정.
# 이 SA 는 induspot-api 에 roles/run.invoker 가 있어야 한다(컴퓨트 기본 SA 는 editor 보유).
BACKEND_SA = "768699236852-compute@developer.gserviceaccount.com"
# 매 실행마다 고유한 config 버전(같은 id 재생성 불가 회피).
CONFIG_ID = "induspot-config-" + datetime.now().strftime("%Y%m%d-%H%M%S")


def run_cmd(cmd, check=False):
    print(f"\n$ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.strip())
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.strip())
        if check:
            sys.exit(f"명령 실패(exit {result.returncode}). 중단합니다.")
        return False
    return True


def get_gateway_hostname():
    result = subprocess.run(
        ["gcloud", "api-gateway", "gateways", "describe", GATEWAY_ID,
         f"--location={REGION}", f"--project={PROJECT}",
         "--format=value(defaultHostname)"],
        capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def deploy():
    if not os.path.exists(YAML_PATH):
        sys.exit(f"Error: {YAML_PATH} 가 현재 디렉터리에 없습니다. apps/api 에서 실행하세요.")

    print("=== 1. 필요한 GCP 서비스 활성화 ===")
    for service in (
        "apigateway.googleapis.com",
        "servicecontrol.googleapis.com",
        "servicemanagement.googleapis.com",
    ):
        run_cmd(["gcloud", "services", "enable", service, f"--project={PROJECT}"], check=True)

    print("\n=== 2. API 리소스 확인/생성 ===")
    api_exists = run_cmd(
        ["gcloud", "api-gateway", "apis", "describe", API_ID, f"--project={PROJECT}"]
    )
    if not api_exists:
        run_cmd(
            ["gcloud", "api-gateway", "apis", "create", API_ID, f"--project={PROJECT}"],
            check=True,
        )

    print(f"\n=== 3. API Config 생성 ({CONFIG_ID}) ===")
    # 비공개 Cloud Run 을 호출하려면 게이트웨이가 backend-auth SA 의 OIDC 토큰을 붙여야 한다.
    run_cmd(
        ["gcloud", "api-gateway", "api-configs", "create", CONFIG_ID,
         f"--api={API_ID}", f"--openapi-spec={YAML_PATH}",
         f"--backend-auth-service-account={BACKEND_SA}", f"--project={PROJECT}"],
        check=True,
    )

    print("\n=== 4. Gateway 생성/업데이트 ===")
    gw_exists = run_cmd(
        ["gcloud", "api-gateway", "gateways", "describe", GATEWAY_ID,
         f"--location={REGION}", f"--project={PROJECT}"]
    )
    if not gw_exists:
        print("신규 게이트웨이 프로비저닝(3~5분 소요 가능)...")
        run_cmd(
            ["gcloud", "api-gateway", "gateways", "create", GATEWAY_ID,
             f"--api={API_ID}", f"--api-config={CONFIG_ID}",
             f"--location={REGION}", f"--project={PROJECT}"],
            check=True,
        )
    else:
        print("기존 게이트웨이를 새 Config 버전으로 업데이트...")
        run_cmd(
            ["gcloud", "api-gateway", "gateways", "update", GATEWAY_ID,
             f"--api={API_ID}", f"--api-config={CONFIG_ID}",
             f"--location={REGION}", f"--project={PROJECT}"],
            check=True,
        )

    hostname = get_gateway_hostname()
    print("\n=== 배포 완료 ===")
    if hostname:
        print(f"Gateway URL: https://{hostname}")
        print("\n다음 두 가지를 반드시 적용하세요:")
        print(f"  1) CI 의 NEXT_PUBLIC_API_GATEWAY_URL 을 'https://{hostname}' 로 설정")
        print("     (.github/workflows/firebase-hosting.yml)")
        print("  2) backend-auth SA 가 induspot-api 를 호출할 수 있는지 확인(보통 컴퓨트 기본 SA=editor 라 이미 가능):")
        print("     gcloud run services add-iam-policy-binding induspot-api \\")
        print("       --region=asia-northeast3 --project=knudc-henryseo711 \\")
        print(f"       --member=serviceAccount:{BACKEND_SA} --role=roles/run.invoker")
        print("     (Cloud Run 은 비공개로 유지한다 — allUsers 공개 금지.)")
    else:
        print("게이트웨이 hostname 을 아직 가져오지 못했습니다(프로비저닝 중일 수 있음).")
        print("잠시 후 확인: gcloud api-gateway gateways describe "
              f"{GATEWAY_ID} --location={REGION} --project={PROJECT} "
              "--format='value(defaultHostname)'")


if __name__ == "__main__":
    deploy()
