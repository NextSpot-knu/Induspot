"""런타임 서비스계정(컴퓨트 기본)에 프로젝트 수준 IAM 역할을 부여한다(멱등).

배경(감사 블로커):
  - 라이브 리비전이 Secret Manager 접근(secretAccessor) 과 Vertex AI(aiplatform.user) 권한이 없어
    GCP-native 경로(WP1 Vertex predict / WP3 Gemini / Firestore / BigQuery / Pub/Sub / GCS 모델)가
    조용히 폴백만 타고 있었다. 이 스크립트는 다른 스트림이 활성화하는 모든 GCP 경로가 실제로
    동작하도록 런타임 SA 에 필요한 역할을 한 번에 묶어 부여한다.

설계:
  - `gcloud projects add-iam-policy-binding` 은 같은 (member, role) 을 다시 추가해도 무해하다
    → 멱등. 재실행해도 정책이 중복으로 부풀지 않는다.
  - 어떤 바인딩이 실패해도 다음 바인딩을 계속 시도하고, 끝에 실패 목록을 출력한다
    (예: 조직 정책으로 일부 역할이 막힌 경우 운영자가 즉시 인지).
  - 클라우드 변경 명령이므로 이 환경에서는 실행하지 않는다 — 배포(deploy.ps1 -Provision)에서 실행.

실행:
  cd apps/api && python scripts/grant_runtime_iam.py
  # (auto 분류기가 막으면 사용자가 직접 실행한다 — README 참고.)
"""

import subprocess
import sys

from _gcloud import GCLOUD  # gcloud.cmd 전체 경로(Windows WinError 2 회피)

PROJECT = "knudc-henryseo711"
# Cloud Run 런타임/잡 실행 서비스계정(컴퓨트 기본). 배포 환경에 맞게 바꿀 수 있다.
RUNTIME_SA = "768699236852-compute@developer.gserviceaccount.com"

# 각 스트림이 활성화하는 GCP-native 경로별로 필요한 최소 역할.
#   secretmanager.secretAccessor : Secret Manager 비밀 읽기(config.load_gcp_secrets)
#   aiplatform.user              : Vertex Endpoint predict(WP1) + Gemini 생성(WP3)
#   datastore.user               : Firestore 선호 벡터 읽기/쓰기(Pinecone 대체)
#   bigquery.dataEditor          : congestion_logs 스트리밍 인서트(WP2 수집 싱크)
#   bigquery.jobUser             : BigQuery 쿼리 잡 실행(예측 lookup 조회/BQML)
#   pubsub.publisher             : 점유 이벤트 발행(WP4 publisher)
#   pubsub.subscriber            : push 구독 소비(WP4 ingest)
#   storage.objectAdmin          : GCS 모델 읽기(WP1 폴백) + Dataflow temp/staging 쓰기(WP5)
#   dataflow.worker              : Dataflow 워커 SA 실행(WP5 스트리밍 윈도잉 잡)
ROLES = [
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
    "roles/datastore.user",
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
    "roles/pubsub.publisher",
    "roles/pubsub.subscriber",
    "roles/storage.objectAdmin",
    "roles/dataflow.worker",
]


def grant(role: str) -> bool:
    """프로젝트 수준에서 RUNTIME_SA 에 role 부여(멱등). 성공 시 True."""
    cmd = [
        GCLOUD, "projects", "add-iam-policy-binding", PROJECT,
        f"--member=serviceAccount:{RUNTIME_SA}",
        f"--role={role}",
        "--condition=None",
        "--format=none",
        f"--project={PROJECT}",
    ]
    print(f"$ grant {role} -> {RUNTIME_SA}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and r.stderr:
        # Log only the last stderr line (English-style operator log).
        print("   ", r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "")
    return r.returncode == 0


def main():
    failed = []
    for role in ROLES:
        if not grant(role):
            failed.append(role)

    print(f"\ngranted: {[r for r in ROLES if r not in failed]}")
    if failed:
        # 실패는 비치명적으로 보고하되 exit code 1 로 배포 단계에서 가시화.
        print(f"FAILED roles (re-run or check org policy / permissions): {failed}")
        print("IAM_PARTIAL")
        sys.exit(1)

    # 성공 마커(배포 스크립트가 grep 으로 단계 성공을 확인).
    print("IAM_OK")


if __name__ == "__main__":
    main()
