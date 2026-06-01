"""Step A (numpy 2.x env): GCS model.pkl 에서 계수/카테고리를 추출해 JSON 으로 저장.
재학습 없음 — 기존 학습 결과(coef_/intercept_/categories_)를 그대로 뽑아낸다.
검증용으로 입력 그리드에 대한 예측값도 함께 저장한다(Step B 재구성 모델과 대조용).
GCP 는 읽기만 한다(storage.objects.get)."""
import json
import pickle
import numpy as np
from google.cloud import storage

PROJECT = "knudc-henryseo711"
BUCKET = "induspot-models-6757"
OUT = "scripts/_model_coef.json"

data = storage.Client(project=PROJECT).bucket(BUCKET).blob("models/model.pkl").download_as_bytes()
obj = pickle.loads(data)
ridge = obj["model"]
enc = obj["encoder"]

categories = [list(map(str, arr.tolist())) for arr in enc.categories_]
coef = np.asarray(ridge.coef_, dtype=float).ravel().tolist()
intercept = float(np.asarray(ridge.intercept_).ravel()[0]) if np.ndim(ridge.intercept_) else float(ridge.intercept_)

# 인코더 파라미터(재구성 시 동일하게 맞춤)
enc_params = {
    "handle_unknown": getattr(enc, "handle_unknown", "ignore"),
    "sparse_output": getattr(enc, "sparse_output", False),
}

# 검증용 예측 그리드: 각 카테고리 컬럼의 대표값 조합 (norm_type x hour x dow 일부)
norm_types = categories[0]
hours = categories[1] if len(categories) > 1 else ["12"]
dows = categories[2] if len(categories) > 2 else ["2"]
grid = []
for t in norm_types:
    for h in hours[: min(4, len(hours))]:
        for d in dows[: min(3, len(dows))]:
            grid.append([t, h, d])
X = enc.transform(grid)
preds = np.asarray(ridge.predict(X), dtype=float).ravel().tolist()

out = {
    "categories": categories,
    "coef": coef,
    "intercept": intercept,
    "encoder_params": enc_params,
    "n_features": len(coef),
    "grid": grid,
    "grid_predictions": preds,
    "source_sklearn_version": getattr(ridge, "_sklearn_version", "unknown"),
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print("EXTRACT_OK")
print("n_features:", len(coef), "| categories sizes:", [len(c) for c in categories])
print("grid size:", len(grid), "| pred range:", round(min(preds), 4), "~", round(max(preds), 4))
print("source sklearn:", out["source_sklearn_version"])
print("written:", OUT)
