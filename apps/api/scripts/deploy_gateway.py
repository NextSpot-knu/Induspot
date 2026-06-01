"""GCP API Gateway 배포 및 업데이트 스크립트.

이 스크립트는 `openapi-gateway.yaml` 설정을 기반으로 GCP API Gateway 및 API 설정을
gcloud CLI 커맨드를 통해 자동 생성/업데이트합니다.

실행 방법:
poetry run python scripts/deploy_gateway.py
"""

import os
import subprocess
import sys

PROJECT = "knudc-henryseo711"
API_ID = "induspot-gateway-api"
CONFIG_ID = "induspot-config-v1"
GATEWAY_ID = "induspot-gateway"
REGION = "us-central1"
YAML_PATH = "openapi-gateway.yaml"


def run_cmd(cmd):
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False
    print(result.stdout)
    return True


def deploy():
    if not os.path.exists(YAML_PATH):
        print(f"Error: {YAML_PATH} not found.")
        sys.exit(1)

    print("=== 1. GCP API Gateway 서비스 활성화 ===")
    services = [
        "apigateway.googleapis.com",
        "servicecontrol.googleapis.com",
        "servicemanagement.googleapis.com"
    ]
    for service in services:
        run_cmd(["gcloud", "services", "enable", service, f"--project={PROJECT}"])

    print("=== 2. API Gateway 리소스 정의 생성/확인 ===")
    # API가 존재하는지 체크 후 생성
    check_api = run_cmd(["gcloud", "api-gateway", "apis", "describe", API_ID, f"--project={PROJECT}"])
    if not check_api:
        print("API 리소스 생성 중...")
        run_cmd(["gcloud", "api-gateway", "apis", "create", API_ID, f"--project={PROJECT}"])

    print("=== 3. API Config 버전 생성 ===")
    # API Gateway Config 업로드
    config_create = run_cmd([
        "gcloud", "api-gateway", "api-configs", "create", CONFIG_ID,
        f"--api={API_ID}", f"--openapi-spec={YAML_PATH}",
        f"--project={PROJECT}"
    ])
    if not config_create:
        print("Config 생성 실패 (이미 존재하는 버전일 수 있습니다. 새 버전을 배포하거나 config_id를 변경하십시오.)")

    print("=== 4. API Gateway 배포 및 게이트웨이 엔드포인트 연동 ===")
    check_gw = run_cmd(["gcloud", "api-gateway", "gateways", "describe", GATEWAY_ID, f"--location={REGION}", f"--project={PROJECT}"])
    if not check_gw:
        print("신규 게이트웨이 인프라를 프로비저닝합니다 (이 작업은 3~5분 정도 소요될 수 있습니다)...")
        run_cmd([
            "gcloud", "api-gateway", "gateways", "create", GATEWAY_ID,
            f"--api={API_ID}", f"--api-config={CONFIG_ID}",
            f"--location={REGION}", f"--project={PROJECT}"
        ])
    else:
        print("기존 게이트웨이를 새 Config 버전으로 업데이트합니다...")
        run_cmd([
            "gcloud", "api-gateway", "gateways", "update", GATEWAY_ID,
            f"--api={API_ID}", f"--api-config={CONFIG_ID}",
            f"--location={REGION}", f"--project={PROJECT}"
        ])

    print("=== 5계층 API Gateway 배포 시도 완료 ===")


if __name__ == "__main__":
    deploy()
