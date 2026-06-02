# InduSpot GCP-Native 활성화 런북 (Capstone Runbook)

> 본 문서는 GCP-native 업그레이드(WP1~WP5)로 **코드에 이미 반영된 것**과, 그것을 **라이브로 전환하는 단 하나의 클라우드 동작**을 계층별로 정리한 단일 활성화 런북입니다.
> 톤/한글 표기는 `architecture_overview.md`(AS-IS 정본)를 따르며, 모든 명령/로그는 영어 원문 그대로 둡니다.
> 대상 환경에는 gcloud 자격증명이 없으므로 **이 문서의 클라우드 명령은 사용자(또는 CI)가 직접 실행**합니다 — 코드는 모두 준비되어 있고, 프로비저닝 스크립트는 멱등(재실행 안전)합니다.

## 0. 프로젝트 사실값 (verbatim — 발명 금지)

| Key | Value |
| --- | --- |
| GCP_PROJECT_ID | `knudc-henryseo711` |
| Cloud Run service | `induspot-api` (region `asia-northeast3`) |
| Cloud Run base URL | `https://induspot-api-to7m2nnlca-du.a.run.app` |
| API Gateway URL | `https://induspot-gateway-9t4vof78.uc.gateway.dev` (loc `us-central1`) |
| Runtime / backend-auth SA | `768699236852-compute@developer.gserviceaccount.com` |
| Vertex online endpoint ID | `2992545745120264192` (region `us-central1`, 배포·스모크 완료) |
| BigQuery dataset | `induspot` (BQ_LOCATION `us-central1`, BQML ARIMA_PLUS) |
| Pub/Sub topic / sub | `induspot-congestion` / `induspot-congestion-push` |
| GCS model bucket | `induspot-models-6757` |
| Firestore | `(default)` Native DB, collection `user_preference_vectors` |

---

## 1. Before → After (계층별 전환표)

각 행: **이전 상태(AS-IS)** vs **현재 코드 상태(코드 준비 완료)** vs **라이브로 전환하는 단 하나의 클라우드 동작**.

| 계층 | Before (이전 상태) | After (현재 코드 상태) | LIVE 전환 동작 (단 하나) |
| --- | --- | --- | --- |
| **수집 (Ingestion)** | 수동 `scratch/publish_events.py` 만 존재, 관리형 발행 없음 | `induspot-publisher` Cloud Run Job + `induspot-publisher-cron` Scheduler(`*/10`)가 `app.jobs.publish_congestion` 실행 → Pub/Sub 발행. `/ingest/pubsub` 가 OIDC 검증 후 수신 | `python scripts/provision_pubsub.py` (또는 `.\deploy.ps1` 의 step a2가 백엔드 배포 직후 자동 실행) → `PUBSUB_PROVISION_OK` |
| **스트리밍 (Streaming)** | Beam 파이프라인 미배포 (코드는 있으나 실행 불가) | `dataflow/congestion_pipeline.py`(파싱·윈도우·per-facility 평균 집계)가 `.venv_beam`로 DataflowRunner 실행 가능. 영속 잡명 `induspot-congestion-windowing` 고정(멱등) | `.\deploy.ps1 -WithStreaming` (또는 `.venv_beam\Scripts\python dataflow\launch_dataflow.py`) → Dataflow 콘솔 RUNNING. **OPTIONAL·상시 과금** |
| **저장 (Storage)** | Firestore `(default)` DB 미생성 가능성(블로커), Pinecone 잔재 키 평문 노출 | `provision_firestore.py` 가 `(default)` Native DB(asia-northeast3) get-or-create. 선호 벡터는 Firestore `user_preference_vectors` (Pinecone 코드/키 0건) | `python scripts/provision_firestore.py` → `FIRESTORE_PROVISION_OK` (+ 런타임 SA `roles/datastore.user`) |
| **AI·ML** | `/predict` 가 GCS-pickle 폴백, Gemini 사유는 템플릿 폴백, BQML 예보 없음 | `VERTEX_ENDPOINT_ID`/`GEMINI_ENABLED` 와이어링 시 라이브 Vertex RPC + Gemini. BQML ARIMA_PLUS → `congestion_forecast_lookup` 사전계산. `/api/v1/forecast/*` 라우터 등록 | (i) `.\deploy.ps1 -Backend` (env 주입으로 Vertex/Gemini ON) + (ii) `python scripts/provision_bigquery.py` → `BQML_OK` |
| **백엔드 (Backend)** | 라이브 리비전에 Secret Manager/Vertex IAM 없음(조용한 폴백), 비밀이 평문 env | 런타임 SA 8개 역할 부여 스크립트 + Secret Manager 5비밀 주입. Cloud Run `--update-secrets` 로 비밀 소싱, OIDC env 주입 | `.\deploy.ps1 -Provision` (IAM_OK→SECRETS_OK) 후 `.\deploy.ps1 -Backend` |
| **프론트엔드 (Frontend)** | Gateway에 forecast 경로 없음 | Gateway openapi에 `/api/v1/forecast/congestion`·`/heatmap`(GET+OPTIONS) 추가, 빌드 시 `NEXT_PUBLIC_API_GATEWAY_URL` 임베드 | `.\deploy.ps1 -Gateway` (새 timestamped api-config 생성·전환) + `.\deploy.ps1 -Frontend` |

> 폴백 보존 원칙: 위 어떤 LIVE 동작이 미수행/실패해도 기존 graceful-degradation(GCS-pickle 예측, 템플릿 사유, `source=unavailable` 예보, 프론트 의사난수 히트맵)이 유지되어 데모/서비스가 멈추지 않습니다.

---

## 2. 활성화 시퀀스 (ORDERED — 반드시 이 순서)

> 모든 명령은 **repo root** (`C:\Users\samsung-user\Desktop\Google_Challenge\Induspot`)에서 시작합니다. PowerShell 기준.

### (i) 일회성 프로비저닝 + 첫 배포 — `.\deploy.ps1 -Backend -Provision`

한 번의 명령으로 **프로비저닝(배포 前) → 백엔드 배포 → Pub/Sub(배포 後)** 가 올바른 순서로 실행됩니다. `provision_pubsub.py` 의 publisher Cloud Run Job 단계는 `induspot-api` 이미지가 존재해야 하므로(`get_api_image`), 의도적으로 백엔드 배포 *뒤*(step a2)에 배치했습니다. 각 단계는 `$LASTEXITCODE` 가드·멱등·성공 마커 출력.

```powershell
.\deploy.ps1 -Backend -Provision
```

실행 순서와 기대 마커:

**(0) 배포 前 프로비저닝** (`apps/api` 에서, IAM → 비밀 → 백킹스토어 순):
1. `grant_runtime_iam.py` — 런타임 SA에 8개 역할 부여 → `IAM_OK`
   (`secretmanager.secretAccessor`, `aiplatform.user`, `datastore.user`, `bigquery.dataEditor`, `bigquery.jobUser`, `pubsub.publisher`, `pubsub.subscriber`, `storage.objectViewer`)
2. `setup_secrets.py` — `apps/api/.env` 의 5개 값을 Secret Manager에 get-or-create + `:latest` 버전 추가 + SA에 secretAccessor → `SECRETS_OK`
3. `provision_firestore.py` — `(default)` Native DB(asia-northeast3) get-or-create → `FIRESTORE_PROVISION_OK`
4. `provision_bigquery.py` — dataset + `congestion_logs`(계약 스키마) + BQML ARIMA_PLUS(CREATE OR REPLACE) + `congestion_forecast_lookup` → `BQML_OK` (**수 분 소요**; 아래 주의 참조)

**(a) 백엔드 배포** — Cloud Run에 이미지 생성 + `--update-env-vars`(4키)/`--update-secrets`(5비밀) 주입.

**(a2) 배포 後 Pub/Sub** (`-Provision` 일 때만 실행): `provision_pubsub.py` — 토픽/push 구독/run.invoker + publisher Job/Scheduler → `PUBSUB_PROVISION_OK`. 이미지가 이미 존재하므로 publisher Job 생성이 성공합니다.

> **주의 (BQML 학습 데이터 선행):** ARIMA_PLUS 학습은 `congestion_logs` 에 히스토리가 있어야 합니다. 빈 테이블이면 4단계(`provision_bigquery.py`)의 학습이 실패할 수 있으니, 먼저 `cd apps/api; poetry run python scripts/load_bq.py`(Supabase → BQ full 적재)로 히스토리를 채운 뒤 `-Provision` 을 재실행하세요(멱등). **load_bq.py·provision_bigquery.py·_provision_infra.py·런타임 insert_congestion_rows 가 모두 동일한 `congestion_logs` 계약 스키마**(`facility_id` / `congestion_level` / `current_count` / `source` / `timestamp`)를 사용하므로, 어느 스크립트가 먼저 테이블을 만들어도 스키마가 일치합니다(BQML 은 학습 SELECT 에서 `timestamp`→`ts`, `congestion_level`→`congestion` 으로 alias).

### (ii) 정상 배포 — `.\deploy.ps1`

플래그 없이 실행하면 **Backend → Gateway → Frontend** 순서로 배포합니다(`-Provision`·`-WithStreaming` 은 기본 포함되지 않음, opt-in).

```powershell
.\deploy.ps1
```

- **(a) Backend**: `gcloud run deploy induspot-api --source apps/api ...` 에 단일 `--update-env-vars`(4키) + 단일 `--update-secrets`(5비밀) 주입. 이로써 `/predict` 가 GCS-pickle 폴백 → 라이브 Vertex endpoint(`2992545745120264192`)로, 사유 생성이 템플릿 → Gemini로 전환됩니다.
- **(a2) Pub/Sub provisioning**: `-Provision` 일 때만 실행됩니다. 플래그 없는 정상 배포(`.\deploy.ps1`)는 이미 멱등 프로비저닝된 토픽/구독/Job 을 다시 만들지 않도록 이 단계를 **건너뜁니다**. 재프로비저닝이 필요하면 `.\deploy.ps1 -Backend -Provision`.
- **(a3) BigQuery**: 문서화된 **수동** 단계(학습이 수 분 걸려 매 배포를 막지 않음). 모델 (재)학습 필요 시 `cd apps/api; poetry run python scripts/provision_bigquery.py`.
- **(b) Gateway**: 새 timestamped api-config 생성 후 REST PATCH(`updateMask=apiConfig`)로 전환(~1–2분 반영). forecast 경로가 라우팅됩니다.
- **(c) Frontend**: Next static export(webpack) 빌드 → Firebase Hosting(`induspot`) 배포 → `https://induspot.web.app`.

부분 배포 예:

```powershell
.\deploy.ps1 -Backend            # Cloud Run 만
.\deploy.ps1 -Backend -Gateway   # openapi 변경 시
.\deploy.ps1 -Frontend           # 대부분의 프론트 변경
.\deploy.ps1 -Gateway            # forecast 경로 라우팅만
```

### (iii) 검증 (Verification)

```powershell
# 1) 라이브 AI 와이어링: Vertex source=vertex + Cloud Run /predict 200 + Gemini 사유가 템플릿과 다름
cd apps/api
poetry run python scripts/verify_ai_live.py     # expect:  === RESULT: PASS ===

# 2) BigQuery congestion_logs 행 적재 확인 (publisher → push → /ingest/pubsub 듀얼라이트)
bq query --use_legacy_sql=false 'SELECT COUNT(*) FROM `knudc-henryseo711.induspot.congestion_logs`'

# 3) Firestore (default) DB 존재 확인
gcloud firestore databases describe --database="(default)" --project knudc-henryseo711

# 4) Gateway forecast 경로 200
curl -s -o /dev/null -w "%{http_code}\n" "https://induspot-gateway-9t4vof78.uc.gateway.dev/api/v1/forecast/heatmap?hours=24"   # expect 200
```

`verify_ai_live.py` 판정 기준:
- **Vertex wiring**: `predict_service._predict_with_vertex` 가 None 이 아니면 `source=vertex`.
- **Cloud Run /predict**: HTTP 200 + 숫자 `predicted_congestion`.
- **Gemini reason**: `reason_service.generate_reason` 출력이 결정적 템플릿(`_build_template`)과 **다르면** Gemini 활성.
하나라도 FAIL이면 종료코드 1.

---

## 3. Cloud Run 에 주입되는 환경변수 + 비밀

### 3.1 `--update-env-vars` (단일 플래그, 4키 — 평문 env, merge)

| Key | Value | 효과 |
| --- | --- | --- |
| `VERTEX_ENDPOINT_ID` | `2992545745120264192` | `/predict` 를 GCS-pickle 폴백 → 라이브 Vertex online RPC로 전환 |
| `GEMINI_ENABLED` | `true` | Vertex Gemini 사유 생성 ON (실패 시 템플릿 폴백) |
| `PUBSUB_PUSH_SERVICE_ACCOUNT` | `768699236852-compute@developer.gserviceaccount.com` | `/ingest/pubsub` OIDC SA email 검증 |
| `PUBSUB_PUSH_AUDIENCE` | `https://induspot-api-to7m2nnlca-du.a.run.app/ingest/pubsub` | `/ingest/pubsub` OIDC audience 검증 |

> `--update-env-vars`(merge)만 사용하고 `--set-env-vars`(wipe)는 절대 쓰지 않습니다. 기타 `GCP_PROJECT_ID`, `VERTEX_LOCATION`, `BQ_*`, `GEMINI_MODEL`, `ALLOWED_ORIGINS` 등은 이미지/.env/`config.py` 기본값으로 유지됩니다.
> OIDC 동작: `PUBSUB_PUSH_*` 둘 다 비면 검증 생략(개발). 둘 다 설정 시 누락/비-Bearer → 401, 토큰 검증 실패 → 401, SA email 불일치 → 403. deploy.ps1이 둘 다 주입하므로 라이브에서는 검증 ON.

### 3.2 `--update-secrets` (단일 플래그, 5비밀 — Secret Manager `:latest`)

| Env name | Secret ref |
| --- | --- |
| `SUPABASE_URL` | `SUPABASE_URL:latest` |
| `SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY:latest` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY:latest` |
| `JWT_SECRET` | `JWT_SECRET:latest` |
| `GCS_BUCKET_NAME` | `GCS_BUCKET_NAME:latest` |

> `config.load_gcp_secrets()` 가 부팅 시 Secret Manager에서 위 키를 우선 로드하고, 없으면 환경변수/.env로 폴백합니다. 비밀 값은 `setup_secrets.py` 에서 argv가 아닌 stdin(`--data-file=-`)으로만 전달되어 프로세스 목록/로그에 노출되지 않습니다.

### 3.3 publisher Cloud Run Job env (별도)

`deploy_publisher_job.py` 가 `induspot-publisher` Job에 주입: `--set-env-vars GCP_PROJECT_ID=knudc-henryseo711,PUBSUB_TOPIC=induspot-congestion` + `--set-secrets SUPABASE_URL=...:latest,SUPABASE_SERVICE_ROLE_KEY=...:latest`.

---

## 4. 통합 Raw 클라우드 명령 (스트림별 수집)

> 모두 멱등. 이 환경에서는 실행하지 않으며, 사용자가 직접 실행합니다.

### 4.1 API 활성화 + 런타임 IAM (Stream A·E)

```bash
gcloud services enable bigquery.googleapis.com aiplatform.googleapis.com \
  run.googleapis.com cloudscheduler.googleapis.com pubsub.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com \
  --project knudc-henryseo711

# 런타임 SA 8개 역할 (grant_runtime_iam.py 가 add-iam-policy-binding 로 멱등 부여)
for ROLE in roles/secretmanager.secretAccessor roles/aiplatform.user \
            roles/datastore.user roles/bigquery.dataEditor roles/bigquery.jobUser \
            roles/pubsub.publisher roles/pubsub.subscriber roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding knudc-henryseo711 \
    --member=serviceAccount:768699236852-compute@developer.gserviceaccount.com \
    --role=$ROLE --condition=None
done
```

### 4.2 Secret Manager (Stream E)

```bash
# get-or-create + 새 :latest 버전 + SA accessor (setup_secrets.py 가 stdin 으로 값 전달)
gcloud secrets list --project knudc-henryseo711
gcloud secrets get-iam-policy JWT_SECRET --project knudc-henryseo711   # expect serviceAccount:768699236852-compute@... secretAccessor
```

### 4.3 Firestore (Stream C)

```bash
# Admin API 경로가 막히면 동등 gcloud (already exists = 멱등 성공)
gcloud firestore databases create --database="(default)" \
  --location=asia-northeast3 --type=firestore-native --project=knudc-henryseo711
```

### 4.4 BigQuery (Stream A·B)

```bash
# provision_bigquery.py 가 수행 (dataset/table=IF NOT EXISTS, model/lookup=CREATE OR REPLACE)
bq query --use_legacy_sql=false 'SELECT COUNT(*) FROM `knudc-henryseo711.induspot.congestion_logs`'
```

`congestion_logs` 스키마(공유 계약 = `core/bigquery.py` insert 계약):
`facility_id STRING NULLABLE, congestion_level FLOAT64, current_count INT64, source STRING, timestamp TIMESTAMP` — 전부 NULLABLE(스트리밍 인서트 호환). ARIMA_PLUS 학습 SELECT는 `timestamp → ts`, `congestion_level → congestion` 으로 매핑.

### 4.5 Pub/Sub + Publisher Job/Scheduler (Stream B)

```bash
# provision_pubsub.py 가 토픽→push 구독(OIDC, audience=.../ingest/pubsub, push SA=런타임 SA)
#   →run.invoker→publisher Job+Scheduler(*/10) 까지 수행
# 1회 스모크:
gcloud run jobs execute induspot-publisher --region=asia-northeast3 --project=knudc-henryseo711
```

### 4.6 Dataflow 스트리밍 (Stream D — OPTIONAL)

```bash
# 일회성: beam venv (Cloud Run 이미지에는 포함 안 함)
python -m venv apps/api/.venv_beam
.\apps\api\.venv_beam\Scripts\python -m pip install -r apps/api/dataflow/requirements.txt

# 최초 1회(--update 금지)
cd apps/api ; .\.venv_beam\Scripts\python dataflow\launch_dataflow.py        # 또는 repo root: .\deploy.ps1 -WithStreaming
# 코드/그래프 변경 시(무중단)
cd apps/api ; .\.venv_beam\Scripts\python dataflow\launch_dataflow.py --update

# RUNNING 확인
gcloud dataflow jobs list --region us-central1 --status active --project knudc-henryseo711
# 데모 후 비용 정지(반드시)
gcloud dataflow jobs cancel <JOB_ID> --region us-central1 --project knudc-henryseo711   # 또는 drain(in-flight 윈도우 flush)
```

### 4.7 검증 명령 모음

```bash
# 런타임 SA 8개 역할 확인
gcloud projects get-iam-policy knudc-henryseo711 \
  --flatten='bindings[].members' \
  --filter='bindings.members:768699236852-compute@developer.gserviceaccount.com' \
  --format='value(bindings.role)'

# 라이브 리비전이 5개 secret ref 를 갖는지
gcloud run services describe induspot-api --region asia-northeast3 --project knudc-henryseo711 \
  --format='value(spec.template.spec.containers[0].env)'
```

---

## 5. 남은 MANUAL/RISK 항목 + 롤백

### 5.1 RISK (운영자 직접 확인 필요)

- **SA 키 회전/폐기 (보안 우선)**: 통합 과정에서 발견된 Pinecone 라이브 키(`pcsk_6mYUKV_...`)가 평문으로 커밋되어 있었습니다. `.env` 에서 제거 완료되었으나 **Pinecone 콘솔에서 즉시 폐기/회전**하세요. 또한 deploy.ps1의 SA 키(`knudc-henryseo711-775e5ed806b7.json`)는 repo root **바깥**(`...\Google_Challenge\`)에 위치해 커밋 불가하지만, 정기 회전 대상입니다. `.gitignore` 가 repo-root scoped `/*-*.json`·`/knudc-*.json`·`*.env`(단, `!*.env.example` 예외)로 SA키/.env 누출을 차단합니다.
- **Dataflow 비용 (OPTIONAL)**: 스트리밍 잡은 워커 상시 가동으로 **지속 과금**됩니다. `-WithStreaming` 은 기본 배포에서 제외(opt-in)되어 있고, 데모 후 반드시 `cancel`(또는 `drain`)로 종료하세요.
- **BQML 리전 (us-central1)**: BigQuery dataset/BQML은 `us-central1`(BQ_LOCATION), Cloud Run·Firestore·Pub/Sub publisher는 `asia-northeast3`, Vertex endpoint는 `us-central1`. 리전 혼재는 의도된 것(BQML ARIMA_PLUS 지원 리전)이며, 변경 시 `config.py`·`launch_dataflow.py`·`provision_bigquery.py` 의 리전 상수를 함께 맞춰야 합니다.
- **provision_pubsub 이미지 선행 의존 (해결됨)**: `provision_pubsub.py` 의 publisher Job 단계는 `induspot-api` 이미지가 필요합니다. `deploy.ps1` 에서 이 단계를 `-Provision` 블록(배포 前)에서 빼고 **배포 後 step a2**(`-Provision` 게이트)로 옮겨, `.\deploy.ps1 -Backend -Provision` 한 번이면 provision→deploy→pubsub 순서가 보장됩니다. 별도 조치 불필요.
- **BQML 학습 데이터 선행**: `congestion_logs` 가 비어 있으면 ARIMA_PLUS 학습이 의미 없는 결과/에러를 낼 수 있어 `load_bq.py`(full) 선행 권장.
- **congestion_logs 스키마 단일화 (해결됨)**: `provision_bigquery.py`·`_provision_infra.py`·`load_bq.py`·런타임 `insert_congestion_rows`·`_run_bqml.py`·`sql/bqml_forecast.sql` 가 **모두 동일 계약 스키마**(`facility_id`/`congestion_level`/`current_count`/`source`/`timestamp`, 전부 NULLABLE)로 정렬되었습니다. BQML 학습 SELECT 만 `timestamp`→`ts`, `congestion_level`→`congestion` alias 를 씁니다. 어느 스크립트가 테이블을 먼저 만들어도 get-or-create 가 충돌하지 않습니다.

### 5.2 MANUAL 단계 (자동 배포에 포함되지 않음)

- `provision_bigquery.py`(BQML 학습, 수 분) — `-Provision` 에는 포함되지만 매 `-Backend` 배포에는 자동 실행되지 않음(step a3는 안내만).
- `-WithStreaming`(Dataflow) — 항상 opt-in.
- `verify_ai_live.py` — 배포 후 수동 스모크.

### 5.3 롤백 (Rollback)

- 모든 GCP-native 변경은 브랜치 **`feat/gcp-native`** 에 격리되어 있습니다. 문제가 생기면:
  ```bash
  git checkout main          # 또는 이전 안정 브랜치
  .\deploy.ps1 -Backend -Gateway -Frontend   # 이전 코드로 재배포
  ```
- Cloud Run은 리비전 롤백으로 즉시 복구 가능:
  ```bash
  gcloud run services update-traffic induspot-api --to-revisions=<PREV_REVISION>=100 \
    --region asia-northeast3 --project knudc-henryseo711
  ```
- 환경변수만 되돌리려면 `--update-env-vars VERTEX_ENDPOINT_ID=,GEMINI_ENABLED=false` 로 폴백 경로 강제(코드의 graceful-degradation이 즉시 동작). 비밀은 `:latest` 버전을 이전 버전으로 disable/rollback.
- Dataflow는 `cancel`/`drain` 으로 즉시 중단(앱 import와 무관 — Cloud Run 이미지에 beam 미포함이라 앱 부팅에 영향 없음).

---

## 부록 A. 성공 마커 일람 (grep 키)

| 스크립트 | 성공 마커 |
| --- | --- |
| `grant_runtime_iam.py` | `IAM_OK` (부분 실패 시 `IAM_PARTIAL` + exit 1) |
| `setup_secrets.py` | `SECRETS_OK` |
| `provision_firestore.py` | `FIRESTORE_PROVISION_OK` (양 경로 실패 시 `FIRESTORE_PROVISION_FAILED` + 수동 명령 안내) |
| `provision_bigquery.py` | `BQML_OK` |
| `provision_pubsub.py` | `PUBSUB_PROVISION_OK` |
| `deploy_publisher_job.py` | `PUBLISHER_JOB_OK` |
| `verify_ai_live.py` | `=== RESULT: PASS ===` |

## 부록 B. 폴백(graceful-degradation) 보존 확인

- `core/bigquery.py`: `get_bq_client`(GCP_PROJECT_ID 게이팅·lazy·never raise → None), `insert_congestion_rows`(실패 0), `query_forecast`(실패 `[]`).
- `ingest.py`: BQ 듀얼라이트는 Supabase 적재 확정 후 **별도 try/except**로 best-effort, 실패해도 200·멱등 마킹에 영향 없음(`pubsub_bq_dualwrite_failed` 경고만).
- `forecast.py`: 데이터/모델 부재 시 `source=unavailable` + None/빈 배열(프론트 의사난수 폴백 유지).
- `preference_vector_service.py`: `google-cloud-firestore` 미설치/미가용 시 `firestore=None`, `available=False`로 no-op(크래시 없음).
- Vertex/Gemini: 미와이어링·타임아웃·인증 실패 시 각각 GCS-pickle / 템플릿 사유로 폴백.
