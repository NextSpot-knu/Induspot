"""GCP Secret Manager 비밀 일원화 스크립트.

`config.py` 의 load_gcp_secrets() 는 부팅 시 Secret Manager 에서 아래 키들을 우선 로드하고,
없으면 환경변수/.env 로 폴백한다. 이 스크립트는 로컬 .env 의 값을 Secret Manager 에 올리고,
Cloud Run 런타임 서비스계정에 secretAccessor 를 부여한다(멱등).

보안: 비밀 값은 argv 가 아니라 stdin(--data-file=-)으로만 전달해 프로세스 목록/로그에 노출되지 않는다.

실행:
  cd apps/api && python scripts/setup_secrets.py            # apps/api/.env 사용
  python scripts/setup_secrets.py --env-file ../../.env     # 다른 .env 지정

배포 시:
  - 이 스크립트로 비밀을 올린 뒤, Cloud Run 재배포에서 해당 평문 env(--set-env-vars 의 비밀들)를
    제거하면 런타임이 Secret Manager 를 단일 진실원으로 사용한다(config.load_gcp_secrets).
"""

import argparse
import subprocess
import sys

PROJECT = "knudc-henryseo711"
# Cloud Run 런타임 서비스계정(컴퓨트 기본). 배포 환경에 맞게 바꿀 수 있다.
RUNTIME_SA = "768699236852-compute@developer.gserviceaccount.com"

# config.load_gcp_secrets() 의 secret_keys 와 일치해야 한다.
SECRET_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "GCS_BUCKET_NAME",
]


def parse_env(path: str) -> dict:
    env = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        sys.exit(f"Error: env 파일을 찾을 수 없습니다: {path}")
    return env


def run(cmd, value=None):
    """gcloud 실행. value 가 있으면 stdin 으로 전달(argv 노출 방지)."""
    print("$", " ".join(cmd if value is None else cmd + ["(value via stdin)"]))
    r = subprocess.run(cmd, input=value, capture_output=True, text=True)
    if r.returncode != 0 and r.stderr:
        print("   ", r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "")
    return r.returncode == 0


def secret_exists(name: str) -> bool:
    r = subprocess.run(
        ["gcloud", "secrets", "describe", name, f"--project={PROJECT}", "--format=value(name)"],
        capture_output=True, text=True,
    )
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", default=".env", help="비밀 값을 읽을 .env 경로 (기본: apps/api/.env)")
    args = ap.parse_args()

    env = parse_env(args.env_file)
    missing = [k for k in SECRET_KEYS if not env.get(k)]
    if missing:
        print(f"경고: .env 에 값이 없는 키(건너뜀): {missing}")

    for key in SECRET_KEYS:
        val = env.get(key)
        if not val:
            continue
        if not secret_exists(key):
            print(f"=== create secret {key} ===")
            run(["gcloud", "secrets", "create", key,
                 "--replication-policy=automatic", f"--project={PROJECT}"])
        print(f"=== add version {key} ===")
        run(["gcloud", "secrets", "versions", "add", key,
             "--data-file=-", f"--project={PROJECT}"], value=val)
        # 런타임 SA 에 접근 권한 부여(멱등)
        run(["gcloud", "secrets", "add-iam-policy-binding", key,
             f"--member=serviceAccount:{RUNTIME_SA}",
             "--role=roles/secretmanager.secretAccessor", f"--project={PROJECT}"])

    print("\n완료. 재배포 시 Cloud Run 의 해당 평문 env 를 제거하면 Secret Manager 가 단일 진실원이 된다.")


if __name__ == "__main__":
    main()
