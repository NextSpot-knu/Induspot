"""Stream C 인프라 프로비저닝 (일회성, 멱등): Firestore (default) Native DB 생성.

사용자 8차원 선호 벡터 저장소(user_preference_vectors 컬렉션)의 백엔드인
Firestore (default) 데이터베이스를 Cloud Run 과 동일 리전(asia-northeast3)에
get-or-create 방식으로 생성한다. 이미 존재하면 AlreadyExists 를 흡수하고 멱등 종료한다.

설계 노트:
  - 컬렉션 user_preference_vectors 는 스키마리스 KV(문서당 {"vector": [...8], "type": "user"})
    이며 단일 user_id 문서 조회/저장만 하므로 복합 인덱스가 필요 없다(단일 필드 자동 인덱스로 충분).
  - 인덱스를 추가할 경우에도 google.api_core.exceptions.AlreadyExists 를 흡수해 멱등을 유지한다.

인증: ADC. 리전: asia-northeast3 (Cloud Run induspot-api 와 co-locate → 읽기 지연/일관성 최적).

실행(주의: 이 환경은 cloud-mutating 명령을 직접 실행하지 않는다 — 사용자가 직접 실행):
  cd apps/api && python scripts/provision_firestore.py
  (Admin API 경로가 막히면 동등한 gcloud 명령으로 폴백 — 아래 GCLOUD_FALLBACK 참고.)

GCLOUD_FALLBACK (Admin API 미가용/권한 부족 시 동등 명령):
  gcloud firestore databases create --database="(default)" \
      --location=asia-northeast3 --type=firestore-native \
      --project=knudc-henryseo711
"""
import structlog

from _gcloud import GCLOUD  # gcloud.cmd 전체 경로(Windows WinError 2 회피)

logger = structlog.get_logger()

# Fixed config (프로젝트 사실값 — 발명 금지)
PROJECT = "knudc-henryseo711"
# Cloud Run(induspot-api) 과 동일 리전에 co-locate.
LOCATION = "asia-northeast3"
DATABASE = "(default)"
DATABASE_TYPE = "FIRESTORE_NATIVE"


def _provision_via_admin_api() -> bool:
    """Firestore Admin API 로 (default) DB 를 get-or-create. 성공 시 True.

    라이브러리 미설치/권한 부족 등은 False 를 반환해 gcloud 폴백으로 넘긴다.
    AlreadyExists 는 멱등 성공으로 간주한다.
    """
    try:
        # pyrefly: ignore [missing-import]
        from google.cloud import firestore_admin_v1
        # pyrefly: ignore [missing-import]
        import google.api_core.exceptions as gex
    except Exception as e:
        logger.warning("firestore_admin_import_failed", error=str(e))
        return False

    try:
        client = firestore_admin_v1.FirestoreAdminClient()
        parent = f"projects/{PROJECT}"
        db_name = f"{parent}/databases/{DATABASE}"

        # get-or-create: 먼저 존재 확인(멱등).
        try:
            client.get_database(name=db_name)
            logger.info("firestore_database_exists", database=db_name, location=LOCATION)
            return True
        except gex.NotFound:
            pass  # 아래에서 생성

        db = firestore_admin_v1.Database(
            location_id=LOCATION,
            type_=firestore_admin_v1.Database.DatabaseType.FIRESTORE_NATIVE,
        )
        try:
            op = client.create_database(
                request=firestore_admin_v1.CreateDatabaseRequest(
                    parent=parent,
                    database=db,
                    database_id="(default)",
                )
            )
            op.result()  # 생성 완료 대기
            logger.info("firestore_database_created", database=db_name, location=LOCATION)
            return True
        except gex.AlreadyExists:
            # 동시/재실행 경합 — 멱등 성공.
            logger.info("firestore_database_already_exists", database=db_name)
            return True
    except Exception as e:
        # 권한 부족(PermissionDenied) 등 → gcloud 폴백 시도.
        logger.warning("firestore_admin_provision_failed", error=str(e))
        return False


def _provision_via_gcloud() -> bool:
    """Admin API 가 막힌 경우 동등한 gcloud 명령으로 폴백(멱등).

    'already exists' stderr 는 멱등 성공으로 흡수한다.
    """
    import subprocess

    cmd = [
        GCLOUD, "firestore", "databases", "create",
        f"--database={DATABASE}",
        f"--location={LOCATION}",
        "--type=firestore-native",
        f"--project={PROJECT}",
    ]
    try:
        print("$", " ".join(cmd))
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            logger.info("firestore_database_created_via_gcloud", location=LOCATION)
            return True
        stderr = (r.stderr or "").lower()
        if "already exists" in stderr or "already_exists" in stderr:
            logger.info("firestore_database_already_exists_via_gcloud")
            return True
        logger.warning(
            "firestore_gcloud_provision_failed",
            returncode=r.returncode,
            error=(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ""),
        )
        return False
    except FileNotFoundError:
        logger.warning("gcloud_not_found")
        return False
    except Exception as e:
        logger.warning("firestore_gcloud_provision_error", error=str(e))
        return False


def main() -> int:
    # 1) Admin API 우선 → 2) gcloud 폴백.
    ok = _provision_via_admin_api()
    if not ok:
        logger.info("firestore_provision_falling_back_to_gcloud")
        ok = _provision_via_gcloud()

    if ok:
        print("FIRESTORE_PROVISION_OK")
        return 0

    # 멱등 보장은 했으나 양쪽 경로 모두 실패 → 사용자가 GCLOUD_FALLBACK 명령을 직접 실행하도록 안내.
    print(
        "FIRESTORE_PROVISION_FAILED: run manually -> "
        f'gcloud firestore databases create --database="{DATABASE}" '
        f"--location={LOCATION} --type=firestore-native --project={PROJECT}"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
