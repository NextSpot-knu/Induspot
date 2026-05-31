"""Step B (Python 3.11 + numpy 1.26 + scikit-learn 1.3.2 env): 버전 스큐 해결 + 재배포.

배경: 서빙 컨테이너 크래시의 근본 원인은
  ModuleNotFoundError: No module named 'numpy._core'
즉 numpy 2.x(로컬)로 직렬화한 아티팩트를 numpy 1.x prebuilt 컨테이너(sklearn-cpu.1-3)가
못 읽어서다. 게다가 sklearn 도 1.8 vs 1.3 으로 어긋난다.

해결: model.pkl 은 numpy 2.x 형식이라 numpy 1.x 에서 직접 못 연다. 그래서
  _extract_coef.py(numpy 2.x env)가 뽑아둔 계수/카테고리 JSON 으로부터
  **컨테이너와 동일한 sklearn 1.3.2 + numpy 1.x 환경에서 모델을 재구성**한다.
  계수(coef_/intercept_)와 카테고리(categories_)를 그대로 옮기므로 동작은 동일하다(재학습 X).
  → numpy·sklearn 스큐가 모두 사라진 model.joblib 을 만들어 같은 GCS 경로로 올리고 재배포.

사전: scripts/_model_coef.json 이 있어야 한다(_extract_coef.py 선행).
"""
import os
import sys
import json
import numpy as np
import joblib
from sklearn.preprocessing import OneHotEncoder
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
BUCKET = "induspot-models-6757"
PREFIX = "vertex/congestion-ridge"
DISPLAY_NAME = "induspot-congestion-ridge"
ENDPOINT_ID = "2992545745120264192"
SERVING_CONTAINER_IMAGE_URI = os.environ.get(
    "SERVING_CONTAINER_IMAGE_URI",
    "us-docker.pkg.dev/vertex-ai/prediction/sklearn-cpu.1-3:latest",
)
MACHINE_TYPE = os.environ.get("VERTEX_MACHINE_TYPE", "n1-standard-2")

HERE = os.path.dirname(os.path.abspath(__file__))
COEF_JSON = os.path.join(HERE, "_model_coef.json")
ARTIFACT_LOCAL = os.path.join(os.path.dirname(HERE), "model.joblib")


def banner():
    print(f"numpy={np.__version__}")
    import sklearn
    print(f"sklearn={sklearn.__version__}")
    if np.__version__.startswith("2"):
        sys.exit("ERROR: 이 스크립트는 numpy 1.x 환경에서 실행해야 합니다 (현재 numpy 2.x).")


def rebuild_pipeline() -> Pipeline:
    with open(COEF_JSON, "r", encoding="utf-8") as f:
        d = json.load(f)

    cats = [[str(x) for x in col] for col in d["categories"]]
    enc = OneHotEncoder(
        categories=cats,
        handle_unknown=d["encoder_params"].get("handle_unknown", "ignore"),
        sparse_output=d["encoder_params"].get("sparse_output", False),
    )
    # 명시적 categories 로 fit → categories_ 가 제공 순서 그대로 확정(원본 컬럼 레이아웃 보존)
    enc.fit([[col[0] for col in cats]])
    for i, col in enumerate(cats):
        got = [str(x) for x in enc.categories_[i]]
        assert got == col, f"category order mismatch in column {i}: {got} != {col}"

    ridge = Ridge(alpha=1.0)
    ridge.coef_ = np.array(d["coef"], dtype=float)
    ridge.intercept_ = float(d["intercept"])
    ridge.n_features_in_ = len(d["coef"])

    pipe = Pipeline(steps=[("encoder", enc), ("ridge", ridge)])

    # 충실도 검증: 추출 환경(numpy2)의 예측 그리드와 재구성 모델 예측이 일치해야 함
    X = d["grid"]
    expected = d["grid_predictions"]
    got = np.asarray(pipe.predict(X), dtype=float).ravel().tolist()
    maxdiff = max(abs(a - b) for a, b in zip(got, expected))
    print(f"FIDELITY check: max abs diff = {maxdiff:.3e} over {len(X)} samples")
    assert maxdiff < 1e-6, f"재구성 모델 예측이 원본과 불일치(maxdiff={maxdiff})"

    out_dim = enc.transform([X[0]]).shape[1]
    assert out_dim == len(d["coef"]), f"one-hot 차원({out_dim}) != coef 길이({len(d['coef'])})"
    return pipe


def main():
    banner()
    if not os.path.exists(COEF_JSON):
        sys.exit(f"ERROR: {COEF_JSON} 없음. 먼저 _extract_coef.py 를 실행하세요.")

    pipe = rebuild_pipeline()
    joblib.dump(pipe, ARTIFACT_LOCAL)
    print(f"BUILT numpy-1.x artifact → {ARTIFACT_LOCAL}")

    from google.cloud import storage, aiplatform

    storage.Client(project=PROJECT).bucket(BUCKET).blob(f"{PREFIX}/model.joblib").upload_from_filename(ARTIFACT_LOCAL)
    artifact_uri = f"gs://{BUCKET}/{PREFIX}/"
    print(f"UPLOADED → {artifact_uri}model.joblib")

    aiplatform.init(project=PROJECT, location=LOCATION)
    ep = aiplatform.Endpoint(ENDPOINT_ID)

    # 기존(실패/구) 배포 정리
    for dm in ep.list_models():
        print(f"undeploying stale model {dm.id} ...")
        try:
            ep.undeploy(deployed_model_id=dm.id, sync=True)
        except Exception as e:
            print(f"  undeploy 경고: {e}")

    existing = aiplatform.Model.list(filter=f'display_name="{DISPLAY_NAME}"')
    parent = existing[0].resource_name if existing else None
    model = aiplatform.Model.upload(
        display_name=DISPLAY_NAME,
        artifact_uri=artifact_uri,
        serving_container_image_uri=SERVING_CONTAINER_IMAGE_URI,
        parent_model=parent,
        sync=True,
    )
    print(f"MODEL version: {model.resource_name}")

    print("Deploying (수 분 소요)...")
    model.deploy(endpoint=ep, machine_type=MACHINE_TYPE, traffic_percentage=100, sync=True)

    # 스모크 테스트
    resp = ep.predict(instances=[["cafeteria", "12", "2"], ["parking", "9", "0"]])
    print("SMOKE predictions:", resp.predictions)
    print("\n=== DONE ===")
    print(f"VERTEX_ENDPOINT_ID={ENDPOINT_ID}")
    print(f"VERTEX_LOCATION={LOCATION}")
    print("→ .env / Cloud Run 환경변수에 위 값을 설정하면 predict_service 가 vertex 경로를 1차로 사용합니다.")


if __name__ == "__main__":
    main()
