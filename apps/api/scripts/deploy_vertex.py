"""WP1 — 혼잡 예측 모델을 Vertex AI Model Registry에 등록하고 Endpoint로 서빙.

무엇을 하나:
  1. 기존 GCS의 `models/model.pkl`(dict{model: Ridge, encoder: OneHotEncoder})을 읽어
     **sklearn Pipeline(encoder → ridge)** 로 재조립한다.
       → 이렇게 하면 prebuilt sklearn 서빙 컨테이너가 raw 피처
         [facility_type, hour_str, dow_str] 를 받아 인코딩+추론을 한 번에 처리한다.
       → 클라이언트(predict_service)는 GCS 폴백 경로와 **동일한 raw 피처**만 보내면 되어
         피처 포맷이 학습 스펙(train.py의 OneHotEncoder.fit 입력)과 정확히 일치한다.
  2. Pipeline을 `model.joblib`로 직렬화해 GCS 아티팩트 디렉터리에 업로드.
  3. Vertex AI Model로 업로드(prebuilt sklearn 컨테이너) → Endpoint에 배포.
  4. 멱등: 동일 display_name("induspot-congestion-ridge") Endpoint/Model이 있으면 재사용.

실행:
  cd apps/api
  poetry run python scripts/deploy_vertex.py
  # 출력 끝의 VERTEX_ENDPOINT_ID 를 Cloud Run 환경변수(.env)에 넣으면 WP1 활성화.

사전 셋업:
  gcloud config set project knudc-henryseo711
  gcloud services enable aiplatform.googleapis.com
  # Cloud Run 런타임 SA 에 roles/aiplatform.user 부여

버전 주의:
  서빙 컨테이너 URI는 시점/리전에 따라 바뀐다. 아래 SERVING_CONTAINER_IMAGE_URI 기본값은
  예시이며, 배포 시점에 GCP 공식 문서(Vertex AI prebuilt containers)로 최신값을 확인하라.
  scikit-learn 버전은 학습 환경(pyproject: scikit-learn ^1.4)과 호환되는 이미지를 선택할 것.
  환경변수 SERVING_CONTAINER_IMAGE_URI 로 덮어쓸 수 있다.
"""

import os
import sys
import json
import pickle

# 스크립트를 apps/api 어디서 실행해도 app 패키지를 찾도록 경로 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(parent_dir, ".env"))

from app.core.config import settings  # noqa: E402

# ⚠️ 이 스크립트는 numpy/sklearn 버전이 서빙 컨테이너와 일치하는 환경에서만 직접 쓰라.
#    버전 스큐 환경(numpy 2.x 등)에서는 scripts/_extract_coef.py + scripts/_rebuild_and_deploy.py
#    경로를 사용한다. 자세한 내용은 README "WP1 재배포" 참고.
DISPLAY_NAME = "induspot-congestion-ridge"
ARTIFACT_PREFIX = "vertex/congestion-ridge"  # GCS 아티팩트 디렉터리 (버킷 내부 경로)

# prebuilt scikit-learn 서빙 컨테이너 (배포 시점 최신값 확인 권장)
#
# ⚠️ 버전 스큐 주의: 이 prebuilt 컨테이너(sklearn-cpu.1-3)는 numpy 1.x + sklearn 1.3 을
#    탑재한다. 이 스크립트를 numpy 2.x / sklearn 1.8 환경(예: Python 3.14 poetry venv)에서
#    실행하면, 업로드되는 model.joblib 이 numpy 2.x 형식이라 컨테이너가
#    `ModuleNotFoundError: No module named 'numpy._core'` 로 부팅 크래시한다.
#    → 스큐 없는 배포는 scripts/_extract_coef.py + scripts/_rebuild_and_deploy.py
#      (numpy 1.26 + scikit-learn 1.3.2 환경) 경로를 사용하라. README 의 "WP1 재배포" 참고.
SERVING_CONTAINER_IMAGE_URI = os.environ.get(
    "SERVING_CONTAINER_IMAGE_URI",
    "us-docker.pkg.dev/vertex-ai/prediction/sklearn-cpu.1-3:latest",
)

MACHINE_TYPE = os.environ.get("VERTEX_MACHINE_TYPE", "n1-standard-2")


def _resolve_project_id() -> str:
    project_id = settings.GCP_PROJECT_ID
    adc_path = os.path.join(
        os.environ.get("APPDATA", ""), "gcloud", "application_default_credentials.json"
    )
    if os.path.exists(adc_path):
        try:
            with open(adc_path, "r", encoding="utf-8") as f:
                cred = json.load(f)
                if "quota_project_id" in cred:
                    project_id = cred["quota_project_id"]
        except Exception:
            pass
    return project_id


def build_and_upload_pipeline_artifact(project_id: str) -> str:
    """GCS의 model.pkl → Pipeline(model.joblib) 재조립 → GCS 아티팩트로 업로드.
    반환: 아티팩트 디렉터리 GCS URI (gs://bucket/vertex/congestion-ridge/)."""
    import joblib
    from sklearn.pipeline import Pipeline
    from google.cloud import storage

    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(settings.GCS_BUCKET_NAME)

    print(f"[1/4] Downloading gs://{settings.GCS_BUCKET_NAME}/models/model.pkl ...")
    blob = bucket.blob("models/model.pkl")
    model_data = pickle.loads(blob.download_as_bytes())
    ridge = model_data["model"]
    encoder = model_data["encoder"]

    # 이미 fit된 두 추정기를 Pipeline으로 묶는다(재학습 없이 predict 시 encoder→ridge 순서로 동작).
    pipeline = Pipeline(steps=[("encoder", encoder), ("ridge", ridge)])

    local_artifact = os.path.join(parent_dir, "model.joblib")
    joblib.dump(pipeline, local_artifact)
    print(f"[2/4] Built Pipeline(encoder→ridge) → {local_artifact}")

    artifact_blob_path = f"{ARTIFACT_PREFIX}/model.joblib"
    bucket.blob(artifact_blob_path).upload_from_filename(local_artifact)
    artifact_uri = f"gs://{settings.GCS_BUCKET_NAME}/{ARTIFACT_PREFIX}/"
    print(f"      Uploaded artifact → {artifact_uri}model.joblib")
    return artifact_uri


def get_or_create_model(aiplatform, artifact_uri: str):
    """동일 display_name Model이 있으면 새 버전으로 업로드(부모 재사용), 없으면 신규 생성."""
    existing = aiplatform.Model.list(filter=f'display_name="{DISPLAY_NAME}"')
    parent_model = existing[0].resource_name if existing else None
    if parent_model:
        print(f"[3/4] Reusing Model '{DISPLAY_NAME}' as parent → new version")
    else:
        print(f"[3/4] Creating new Model '{DISPLAY_NAME}'")

    model = aiplatform.Model.upload(
        display_name=DISPLAY_NAME,
        artifact_uri=artifact_uri,
        serving_container_image_uri=SERVING_CONTAINER_IMAGE_URI,
        parent_model=parent_model,
        sync=True,
    )
    print(f"      Model resource: {model.resource_name}")
    return model


def get_or_create_endpoint(aiplatform):
    existing = aiplatform.Endpoint.list(filter=f'display_name="{DISPLAY_NAME}"')
    if existing:
        print(f"[4/4] Reusing Endpoint '{DISPLAY_NAME}'")
        return existing[0]
    print(f"[4/4] Creating Endpoint '{DISPLAY_NAME}'")
    return aiplatform.Endpoint.create(display_name=DISPLAY_NAME)


def main():
    project_id = _resolve_project_id()
    location = settings.VERTEX_LOCATION
    print(f"Project={project_id}  Location={location}")

    try:
        from google.cloud import aiplatform
    except ImportError:
        print("ERROR: google-cloud-aiplatform 미설치. `poetry add google-cloud-aiplatform` 후 재실행.")
        sys.exit(1)

    aiplatform.init(project=project_id, location=location)

    artifact_uri = build_and_upload_pipeline_artifact(project_id)
    model = get_or_create_model(aiplatform, artifact_uri)
    endpoint = get_or_create_endpoint(aiplatform)

    # 이미 같은 모델이 배포돼 있지 않으면 배포(트래픽 100%).
    model_base = model.resource_name.split("@")[0]  # 버전 접미사 제거
    deployed_bases = {dm.model.split("@")[0] for dm in endpoint.list_models()}
    if model_base in deployed_bases:
        print("Model already deployed to endpoint — skipping deploy.")
    else:
        print("Deploying model to endpoint (this can take several minutes)...")
        model.deploy(
            endpoint=endpoint,
            machine_type=MACHINE_TYPE,
            traffic_percentage=100,
            sync=True,
        )

    endpoint_id = endpoint.resource_name.rsplit("/", 1)[-1]
    print("\n=== DONE ===")
    print(f"Endpoint resource : {endpoint.resource_name}")
    print(f"VERTEX_ENDPOINT_ID={endpoint_id}")
    print(f"VERTEX_LOCATION={location}")
    print("→ 위 값을 Cloud Run/.env 환경변수에 설정하면 WP1(Vertex 1차 경로)이 활성화됩니다.")


if __name__ == "__main__":
    main()
