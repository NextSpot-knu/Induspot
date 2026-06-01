# InduSpot API (FastAPI) — GCP 네이티브 백엔드

스마트 공단 인프라 혼잡 분산 추천 엔진. Cloud Run에 배포되며, 예측·생성·수집·저장 계층이
GCP 네이티브 서비스 위에서 동작한다.

## 아키텍처 (계층별 GCP 매핑)

| 계층 | 구현 | 비고 |
|------|------|------|
| 수집 | **Pub/Sub** push → `/ingest/pubsub` (WP4) | OIDC 검증 + 멱등 처리 |
| 저장 | Supabase · GCS(Vertex 아티팩트) · **BigQuery**(WP2) | |
| AI/ML | **Vertex AI Endpoint** 실시간 서빙(WP1) · **BQML** 시계열(WP2) · **Gemini** 사유(WP3) | |
| 서비스 | Cloud Run | |

모든 외부 GCP 호출은 **타임아웃 + 폴백**을 갖는다. 클라우드가 느리거나 죽어도 데모는 멈추지 않는다.

---

## WP1 — Vertex AI Endpoint 혼잡 예측 서빙

`predict_service.predict_congestion(facility_type, hour, day_of_week) -> float` 는 다단 폴백:

```
(a) Vertex AI Endpoint  →  (b) GCS model.pkl  →  (c) 로컬 model.pkl  →  (d) 0.5
```

- 사용 경로는 로그에 `source=vertex|gcs|local|default` 로 남는다.
- `VERTEX_ENDPOINT_ID` 가 비면 (a)를 건너뛰고 (b)로 동작 → Endpoint 미배포 환경에서도 서버 기동.
- 배포 모델은 **sklearn `Pipeline(encoder→ridge)`** 이라, 클라이언트가 보내는 raw 피처
  `[facility_type, hour_str, dow_str]` 가 GCS 폴백 경로와 **동일 포맷**(= `train.py` 인코더 fit 스펙)이다.

**배포:**
```bash
gcloud config set project knudc-henryseo711
gcloud services enable aiplatform.googleapis.com
# Cloud Run 런타임 SA 에 roles/aiplatform.user
# Vertex 서비스 에이전트(service-<PROJNUM>@gcp-sa-aiplatform.iam.gserviceaccount.com)에 아티팩트 버킷 읽기 권한:
gcloud storage buckets add-iam-policy-binding gs://induspot-models-6757 \
  --member="serviceAccount:service-768699236852@gcp-sa-aiplatform.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
cd apps/api && poetry run python scripts/deploy_vertex.py
# 출력된 VERTEX_ENDPOINT_ID / VERTEX_LOCATION 을 .env(또는 Cloud Run env)에 설정
```

### ⚠️ WP1 재배포 — numpy/sklearn 버전 스큐 해결 (필수)

`deploy_vertex.py` 를 numpy 2.x / sklearn 1.8 환경(예: Python 3.14 poetry venv)에서 그대로
실행하면 prebuilt 서빙 컨테이너(`sklearn-cpu.1-3`, numpy 1.x)가 아티팩트를 못 읽어
`ModuleNotFoundError: No module named 'numpy._core'` 로 크래시한다(실측 확인됨).

스큐 없는 배포 절차 — 컨테이너와 동일한 **numpy 1.26 + scikit-learn 1.3.2** 환경에서 모델을
재구성(계수/카테고리만 이전, 재학습 X)한다:

```powershell
# Step A — 계수 추출 (기존 numpy 2.x poetry venv 에서)
cd apps/api
poetry run python scripts/_extract_coef.py        # → scripts/_model_coef.json 생성

# Step B — numpy 1.x 전용 venv 구성 (Python 3.11)
py -3.11 -m venv .venv_deploy
.\.venv_deploy\Scripts\python -m pip install -U pip
.\.venv_deploy\Scripts\python -m pip install "numpy==1.26.4" "scikit-learn==1.3.2" joblib google-cloud-storage google-cloud-aiplatform

# Step B 실행 — 재구성 + 충실도검증 + 업로드 + 재배포 + 스모크테스트 (deploy 단계 수 분)
.\.venv_deploy\Scripts\python scripts/_rebuild_and_deploy.py
```

`_rebuild_and_deploy.py` 는: 충실도 검증(원본 예측과 1e-6 이내 일치) → `model.joblib`(numpy 1.x)
업로드 → 엔드포인트의 기존 실패 배포 undeploy → 새 모델 버전 배포 → `ep.predict` 스모크
테스트까지 수행한다. 성공 시 Endpoint `2992545745120264192` 가 서빙 상태가 된다.

**✅ 배포 완료·검증 (2026-06-01):** 충실도 검증 통과(max abs diff = 1.1e-16, 재구성 모델 = 원본).
모델 `6371679228810756096@2` → Endpoint `2992545745120264192`(us-central1) 배포 완료
(deployedModels=1, availableReplicaCount=1, machine n1-standard-2).
실측 스모크 테스트(`ep.predict`): `["cafeteria","12","2"]→0.0956`, `["parking","9","0"]→0.1763`,
`["meeting_room","15","4"]→0.1555`.
→ Cloud Run/.env 에 `VERTEX_ENDPOINT_ID=2992545745120264192`, `VERTEX_LOCATION=us-central1`
을 설정하면 `predict_service` 가 Vertex 경로를 1차로 사용한다(미설정이면 GCS 폴백으로 정상 동작).

## WP3 — Gemini 추천 사유 생성

`reason_service.generate_reason(context)` 가 추천 **상위 3개**에만 한국어 사유를 생성한다.
- 환각 방지: 시스템 프롬프트로 "입력 수치/사실만 사용, 새 숫자 금지" 강제.
- 실패/타임아웃(`GEMINI_TIMEOUT_SECONDS`) 시 코드 템플릿 문자열로 폴백.
- `GEMINI_ENABLED=false`(기본)면 항상 템플릿. 응답에 `reason`(snake_case) 필드 **추가**.

## WP2 — BigQuery + BQML 시계열 예측

```bash
gcloud services enable bigquery.googleapis.com
# SA 에 roles/bigquery.jobUser + roles/bigquery.dataEditor
cd apps/api && poetry run python scripts/load_bq.py --mode full   # Supabase → BQ 적재
bq query --use_legacy_sql=false < sql/bqml_forecast.sql           # ARIMA_PLUS 모델 + lookup
```
- 스키마 매핑: Supabase `timestamp/congestion_level` → BQ `ts/congestion`, facility_type 조인.
- BQML은 **배치 사전계산(lookup)** 용도. 실시간 단건 1차 경로는 WP1 Vertex Endpoint로 유지(공존).
- `bq_forecast_service.get_forecast_congestion(facility_id)` 로 lookup 조회(타임아웃+폴백).

## WP4 — Pub/Sub 수집 백본

```bash
gcloud services enable pubsub.googleapis.com
gcloud pubsub topics create induspot-congestion
gcloud pubsub subscriptions create induspot-congestion-push \
  --topic=induspot-congestion \
  --push-endpoint="https://<CLOUD_RUN_URL>/ingest/pubsub" \
  --push-auth-service-account="<SA>@knudc-henryseo711.iam.gserviceaccount.com"
# SA 에 roles/pubsub.publisher, roles/pubsub.subscriber
python scratch/publish_events.py --interval 5 --iterations 12     # 더미 이벤트 발행
```
- `POST /ingest/pubsub`: base64 `message.data` 파싱 → `congestion_logs` 적재.
- OIDC 검증: `PUBSUB_PUSH_SERVICE_ACCOUNT`/`PUBSUB_PUSH_AUDIENCE` 설정 시 토큰 검증, 비면 생략.
- 멱등: `messageId` 인스턴스 로컬 LRU(프로덕션은 외부 저장 권장).

---

## 환경변수
신규 변수는 `.env.example` 참조 (`VERTEX_*`, `GEMINI_*`, `BQ_*`, `PUBSUB_*`).
비밀 아닌 식별자(`GCP_PROJECT_ID` 등)는 기본값을 가지며, 모든 WP는 미설정 시 안전하게 비활성/폴백된다.
