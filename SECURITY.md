# InduSpot 보안 하드닝 런북

> GCP 대회 제출 프로젝트(`knudc-henryseo711`)에 대한 다차원 보안 감사 결과와 조치 절차.
> 본 문서의 모든 file:line 근거는 실제 레포 파일을 직접 읽어 검증한 사실이다(추측 없음, 검증일 2026-06-05).
>
> 핵심 원칙: **Secret Manager가 이미 라이브 진실원**이다. 라이브 Cloud Run 리비전은 5개 키
> (`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `JWT_SECRET` / `GCS_BUCKET_NAME`)를
> `--update-secrets ...:latest`로 마운트한다(`deploy.ps1:163`). 디스크의 평문 `.env`는 로컬 편의용 중복일 뿐
> 운영 진실원이 아니다. 따라서 하드닝의 목표는 "평문 제거 + 단일 진실원(SM) 강제 + 키 회전"이다.

---

## 요약 표

| # | 항목 | 심각도 | 현재 상태 | 조치 |
|---|------|--------|-----------|------|
| 1 | 노출 시크릿 디스크 평문 상주 (`apps/api/.env`, 루트 `.env`) | **critical** | `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `KAKAO_REST_API_KEY`, `PINECONE_API_KEY` 등 평문. `.gitignore`가 git 커밋은 차단(이력 clean)하나 디스크에 상존하고 deploy/ADC가 재사용 | §1 키 회전 → §2 평문 비우고 SM 단일소싱 |
| 2 | 장수명 SA키 디스크 상주 + Workload Identity Federation 미사용 | **critical** | `Docs/knudc-henryseo711-775e5ed806b7.json` 평문 키 파일 존재(identity=`firebase-adminsdk-fbsvc@knudc-henryseo711.iam.gserviceaccount.com`). 만료 없음, 폐기 불가 자격증명 | §3 키 회전·삭제 + WIF 전환 |
| 3 | `deploy.ps1` SaKey 기본경로가 실제 위치와 불일치 | **high** | `deploy.ps1:26` 기본값=루트 `...\Google_Challenge\knudc-...json` (Test-Path FALSE). 실제 키는 `Docs\` 아래. ADC 고정이 no-op, 프론트 배포는 `deploy.ps1:220`에서 throw 위험 | §3 경로 정정/자동탐색 또는 CI 일원화 |
| 4 | 최소권한(least-privilege) 위반 | **high** | 컴퓨트 기본 SA(`768699236852-compute@developer`, editor급)를 Cloud Run 런타임·Pub/Sub push·게이트웨이 OIDC에 공용. `grant_runtime_iam.py`가 9개 역할을 **PROJECT 레벨**로 부여 | §4 전용 런타임 SA + 서비스레벨/조건부 권한 |
| 5 | 무인증 공개 엔드포인트 | **medium** | 게이트웨이 OpenAPI에 `securityDefinitions`/`security:` 없음(`openapi-gateway.yaml` 전체). `/predict`, `/api/v1/forecast/*`, `/api/v1/voice/turn` 등이 인증 없이 공개. 1차 방어=Cloud Run `run.invoker` | §5 게이트웨이 인증/레이트리밋. 현재 완화책=`--max-instances=8` + 입력상한 + 타임아웃 |

---

## 1. 노출 시크릿 회전 런북

> 디스크 평문에 노출된 모든 비밀은 **유출로 간주하고 회전**한다. 회전은 (1) 발급처에서 새 키 생성/회전 →
> (2) Secret Manager에 새 버전 추가 → (3) Cloud Run 재배포로 `latest` 픽업 순서다.

노출 비밀 인벤토리(실측):

| 키 | 위치(file:line) | 발급처 | SM에 마운트되는가 |
|----|------|--------|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | `apps/api/.env:6`, 루트 `.env:6` | Supabase 대시보드 | 예 (`deploy.ps1:163`) |
| `JWT_SECRET` | `apps/api/.env:8`, 루트 `.env:8` | Supabase (JWT Secret) | 예 (`deploy.ps1:163`) |
| `KAKAO_REST_API_KEY` | `apps/api/.env:11`, 루트 `.env:16` | Kakao Developers 콘솔 | 아니오(현재 평문 env로만 주입) |
| `PINECONE_API_KEY` | 루트 `.env:11` | Pinecone 콘솔 | 아니오 — **이미 Firestore로 대체됨**(아래 참고) |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_*` | `apps/api/.env:3,5,10` | Supabase / Kakao Map JS | publishable(공개용)·NEXT_PUBLIC=클라이언트 번들 노출 전제 → 회전 우선순위 낮음 |

### 1.1 Supabase `service_role` + JWT Secret

`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회하는 전권 키다 → 최우선 회전.

1. Supabase 대시보드 → **Settings → API → Project API keys** 에서 `service_role` 키 **Rotate**(재발급).
2. 같은 화면(또는 **Settings → API → JWT Settings**)에서 **JWT Secret** 회전.
   - 주의: JWT Secret을 회전하면 기존 발급된 모든 사용자 access token이 무효화된다(전 사용자 재로그인 필요). 데모 일정에 맞춰 수행.
3. 새 값을 Secret Manager 새 버전으로 추가(아래 §1.5).
4. Cloud Run 재배포로 `latest` 픽업(§1.6).

### 1.2 Kakao REST API 키

1. **Kakao Developers 콘솔**(developers.kakao.com) → 내 애플리케이션 → 해당 앱 → **앱 키 → REST API 키 재발급**.
2. 회전 후 SM 일원화를 권장(현재는 평문 env). `KAKAO_REST_API_KEY`를 SM 시크릿으로 생성하고 `deploy.ps1:163`의 `--update-secrets`에 추가한다.
   - 참고: `config.py:88`에서 `KAKAO_REST_API_KEY`는 비어 있으면 Haversine 직선거리 폴백이라 회전 중 일시 공백도 데모를 깨지 않는다.

### 1.3 Pinecone 키 — 회전이 아니라 **제거 권장**

Pinecone은 이미 **Firestore로 대체**되었다(코드 근거):
- 선호 벡터 저장소가 Firestore로 전환됨: `config.py:57-60` (`FIRESTORE_DATABASE`, `FIRESTORE_COLLECTION="user_preference_vectors"`).
- 런타임 코드의 "Pinecone" 언급은 stale 주석/docstring일 뿐 실제 호출 경로 아님: 예) `apps/api/app/services/tttv/preference.py:50,53`은 주석상 "Pinecone에서 조회"라 적혀 있으나 실제 저장소는 Firestore.

조치:
1. **루트 `.env`에서 `PINECONE_API_KEY`/`PINECONE_INDEX_*`(`.env:11-13`) 제거.**
2. Pinecone 콘솔에서 해당 API 키 **삭제(revoke)** — 더 이상 쓰지 않으므로 회전이 아니라 폐기.
3. (선택) preference.py 등의 stale "Pinecone" 주석을 "Firestore"로 정정해 혼동 제거.

### 1.4 인증 도구 준비

```powershell
# 회전/SM 작업은 owner 권한 계정으로(gcloud CLI 계정). SA키 ADC는 secretmanager.admin이 없을 수 있다.
gcloud auth login
gcloud config set project knudc-henryseo711
```

### 1.5 Secret Manager에 새 버전 추가(키별)

> 값을 셸 히스토리/명령줄 인자에 남기지 않기 위해 `--data-file=-`(stdin) 패턴을 사용한다.

```powershell
# 예: 회전한 service_role 키를 새 버전으로 추가 (PowerShell)
"PASTE_NEW_SERVICE_ROLE_KEY" | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=- --project knudc-henryseo711

# JWT Secret
"PASTE_NEW_JWT_SECRET" | gcloud secrets versions add JWT_SECRET --data-file=- --project knudc-henryseo711

# (신규로 SM 일원화할 경우) Kakao REST 키 — 시크릿이 없으면 먼저 생성
gcloud secrets create KAKAO_REST_API_KEY --replication-policy=automatic --project knudc-henryseo711   # 최초 1회만
"PASTE_NEW_KAKAO_REST_KEY" | gcloud secrets versions add KAKAO_REST_API_KEY --data-file=- --project knudc-henryseo711
```

Bash(파일에서 읽어 추가, 추가 후 파일 삭제):

```bash
gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=./new_key.txt --project knudc-henryseo711
shred -u ./new_key.txt   # 평문 임시파일 즉시 파기
```

새 버전이 즉시 `latest`가 되며, 이전 버전은 `gcloud secrets versions disable <SECRET> --version=<N>`으로 무효화한다.

### 1.6 Cloud Run 재배포로 `latest` 픽업

`config.load_gcp_secrets()`(`config.py:135-179`)는 **부팅 시점에 한 번** SM `latest`를 읽어 env로 주입한다. 따라서 SM 버전을 올린 뒤에는 새 리비전 배포가 필요하다.

```powershell
# 표준 백엔드 재배포(임베딩 재시드 생략). deploy.ps1:163의 --update-secrets가 latest를 다시 매핑한다.
.\deploy.ps1 -Backend -SkipReseed
```

검증: 새 리비전 로그에 `Secret Manager: loaded N secret(s) into env`(`config.py:176`)가 찍히는지 확인.

---

## 2. 평문 `.env` → Secret Manager 단일소싱

문제: 운영 진실원은 Secret Manager인데(`deploy.ps1:155-163`), 디스크의 두 평문 파일이 같은 비밀을 중복 보관한다.
- `apps/api/.env:2-18` — service_role / JWT / Kakao 평문.
- 루트 `.env:2-20` — 위 + Pinecone 평문.

라이브 일관성: deploy 시 literal env를 먼저 strip하고(`deploy.ps1:156`) SM 시크릿으로 다시 매핑한다(`deploy.ps1:163`).
즉 **SM이 단일 진실원**이고, 부팅 시 `config.load_gcp_secrets()`가 SM에서 읽는다.

### 2.1 평문 값을 플레이스홀더로 비우기

`apps/api/.env`와 루트 `.env`의 **비밀 값**을 플레이스홀더로 치환한다(키 이름은 문서/로컬 부팅 참조용으로 유지 가능). 예:

```dotenv
# apps/api/.env (비밀은 SM에서 로드 — 여기엔 값을 두지 않는다)
SUPABASE_SERVICE_ROLE_KEY=__set_in_secret_manager__
JWT_SECRET=__set_in_secret_manager__
KAKAO_REST_API_KEY=__set_in_secret_manager__
# 비밀 아님(공개 식별자/리전 등)은 그대로 둬도 무방: GCP_PROJECT_ID, VERTEX_*, GCS_BUCKET_NAME 등
```

루트 `.env`에서는 추가로 `PINECONE_API_KEY`/`PINECONE_INDEX_*`(§1.3) **줄 자체를 삭제**한다.

주의: `JWT_SECRET`은 빈 문자열이면 부팅 시 validator가 실패한다(`config.py:107-114` `_nonempty_jwt_secret`). 따라서
- **클라우드(Cloud Run)**: 부팅 시 `load_gcp_secrets()`가 SM에서 채우므로 문제없음.
- **로컬 개발**: 아래 §2.3 중 하나로 값을 공급해야 부팅된다(빈 값/플레이스홀더만으로는 로컬 부팅 불가).

### 2.2 `load_gcp_secrets` 동작(근거 코드)

`config.py:135-182`:
1. ADC 경로 해석(`_resolve_adc_path`, `config.py:123-132`) — `CLOUDSDK_CONFIG` 우선, 없으면 OS별 기본.
2. `secretmanager` 클라이언트로 5개 키(`config.py:152-158`) 각각 `projects/<proj>/secrets/<KEY>/versions/latest` 접근.
3. **이미 env에 값이 있으면 건너뜀**(`config.py:164` `if os.environ.get(key): continue`) → 로컬 `.env`가 우선, SM은 빈 키만 채움.
4. 로드 개수만 로그(`config.py:176`), 키 이름은 노출하지 않음(보안 위생).
5. 권한 없음/미설치 시 조용히 `.env` 폴백(`config.py:177-179`).

함의: 클라우드 런타임 SA에 `secretmanager.secretAccessor`(§4)가 있어야 이 경로가 작동한다. 없으면 조용히 폴백해 비밀이 비고 401/500이 난다.

### 2.3 로컬 개발 옵션(평문 영구 보관 대체)

- **(권장) ADC + Secret Manager**: `gcloud auth application-default login` 후, 본인 계정에 `secretAccessor`가 있으면 `load_gcp_secrets()`가 로컬에서도 SM `latest`를 읽어 채운다. `.env`에 비밀을 둘 필요가 없다.
- **(차선) `.env.local`**: 비밀을 git에 절대 들어가지 않는 로컬 파일에만 둔다. `.gitignore:43`(`.env*`) + `:80`(`*.env`)이 이미 모든 `.env*`를 차단하므로 `.env.local`도 자동 제외된다. 단 디스크 평문이라는 본질 위험은 ADC 방식이 더 낫다.

> 검증된 사실: `.gitignore`는 `.env*`(`:43`), `*.env`(`:80`), 루트 SA키 글롭 `/*-*.json`·`/knudc-*.json`(`:76-77`)을 제외한다.
> 따라서 git **이력에는 평문이 없다**(clean 확인됨). 위험은 전적으로 **로컬 디스크 상주**다.

---

## 3. SA키 제거 + Workload Identity Federation 전환

### 3.1 검증된 사실

- 실제 SA키 파일: `C:\Users\samsung-user\Desktop\Google_Challenge\Docs\knudc-henryseo711-775e5ed806b7.json` **(존재 확인됨)**.
  - identity = `firebase-adminsdk-fbsvc@knudc-henryseo711.iam.gserviceaccount.com`.
- `deploy.ps1:26` 기본 `$SaKey` = `...\Google_Challenge\knudc-henryseo711-775e5ed806b7.json`(루트) — **존재하지 않음(Test-Path FALSE 확인됨)**.
- 불일치의 실제 영향:
  - `deploy.ps1:69-73`: `Test-Path $SaKey`가 FALSE → `GOOGLE_APPLICATION_CREDENTIALS` 설정이 **no-op**(WARN만 출력, 주변 ADC 사용).
  - `deploy.ps1:98-106`: BigQuery 역할 부여 블록이 `Test-Path $SaKey` 가드라 **통째로 스킵**됨.
  - `deploy.ps1:220`: 프론트(Firebase) 배포 단계는 키가 없으면 **throw로 전체 배포 중단**.
- Workload Identity Federation 미사용(키 기반 ADC에만 의존).

### 3.2 즉시 조치 — 키 회전·삭제

1. 새 키가 정말 필요한 경로만 남기고(아래 §3.3로 키리스 전환), 기존 키를 **삭제**한다.

```powershell
$SA = "firebase-adminsdk-fbsvc@knudc-henryseo711.iam.gserviceaccount.com"

# 현재 키 목록 확인(KEY_ID 파악)
gcloud iam service-accounts keys list --iam-account=$SA --project knudc-henryseo711

# 디스크에 상주하던 장수명 키 삭제(유출 간주)
gcloud iam service-accounts keys delete <KEY_ID> --iam-account=$SA --project knudc-henryseo711
```

2. 로컬 디스크의 키 파일 파기:

```powershell
Remove-Item "C:\Users\samsung-user\Desktop\Google_Challenge\Docs\knudc-henryseo711-775e5ed806b7.json" -Force
```

> 참고: 이 키 파일은 `Docs\` 아래라 `.gitignore`의 루트 한정 글롭(`/knudc-*.json`, `:77`)에 **걸리지 않는다**.
> git에 들어갈 위험을 막으려면 `.gitignore`에 `**/knudc-*.json` 또는 `Docs/*.json` 패턴을 추가하는 것을 권장한다.

### 3.3 deploy.ps1 경로 정정 / 자동탐색 / CI 일원화

목표: 로컬 장수명 SA키 의존 자체를 제거한다. 우선순위 순:

1. **(이미 부분 적용됨) Firebase 프론트 배포는 CI로 일원화돼 있다**: `.github/workflows/firebase-hosting.yml`이 `main` push 시 정적 빌드 후 `w9jds/firebase-action`으로 자동 배포한다(인증=`FIREBASE_TOKEN` 시크릿, `firebase-hosting.yml:46`). 즉 **프론트 배포에는 로컬 SA키가 불필요**하며 `deploy.ps1 -Frontend`는 수동 폴백일 뿐이다. 남은 하드닝: `FIREBASE_TOKEN`(Firebase가 deprecate 예정)을 `FIREBASE_SERVICE_ACCOUNT`(또는 WIF)로 전환.
   - 정정 이력: 1차 분석에서 Glob 도구가 dotfile 디렉터리(`.github/`)를 건너뛰어 "워크플로 부재"로 오판했으나, `find`로 `firebase-hosting.yml` 존재를 확인함.
2. **(차선) `-SaKey` 명시 전달 또는 기본경로 정정**: 당장은 실제 위치를 가리키도록 한다.

```powershell
# 호출 시 실제 경로 전달
.\deploy.ps1 -Frontend -SaKey "C:\Users\samsung-user\Desktop\Google_Challenge\Docs\knudc-henryseo711-775e5ed806b7.json"
```

   또는 `deploy.ps1:26` 기본값을 실제 위치(`...\Docs\...`)로 바꾸거나, 루트→`Docs`를 순차 탐색하는 자동탐색 로직으로 교체한다(키를 키리스로 옮기기 전 임시 조치).

### 3.4 장기 — Workload Identity Federation(키리스)

- GitHub Actions ↔ GCP를 **WIF**로 연결(`google-github-actions/auth` with `workload_identity_provider`)해 JSON 키 발급을 완전히 없앤다.
- 로컬 개발은 `gcloud auth application-default login`(사용자 ADC)으로 대체 — 다운로드 키 불필요.
- 결과: 만료 없는 장수명 키 0개. 유출 표면 제거.

---

## 4. 최소권한 IAM

### 4.1 현재 상태(검증)

`grant_runtime_iam.py`는 컴퓨트 기본 SA(`768699236852-compute@developer.gserviceaccount.com`, `grant_runtime_iam.py:28`)에
**9개 역할을 PROJECT 레벨**로 부여한다(`grant_runtime_iam.py:40-50`, `grant`가 `projects add-iam-policy-binding` 사용 `:55-62`).
같은 SA가 Cloud Run 런타임·Pub/Sub push·게이트웨이 backend-auth OIDC에 공용된다(`deploy.ps1:38,162,194-195`).
컴퓨트 기본 SA는 editor급이라, 여기에 추가 부여까지 더하면 사실상 광범위 권한 단일 신원이 된다.

### 4.2 부여 역할 인벤토리(코드 실측) + 필요 코드경로 매핑

| 역할(`grant_runtime_iam.py:40-50`) | 부여 레벨 | 필요 코드경로(주석 근거 `:31-39`) | 평가 |
|------|-----------|----------------|------|
| `roles/secretmanager.secretAccessor` | PROJECT | `config.load_gcp_secrets`(`config.py:148-176`) 비밀 읽기 | 필수. **시크릿 단위 조건부**로 축소 가능(5개 키만) |
| `roles/aiplatform.user` | PROJECT | Vertex Endpoint predict(WP1) + Gemini 생성(WP3) | 필수(런타임이 Vertex 호출). 프로젝트 한정 불가피하나 SA 분리 권장 |
| `roles/datastore.user` | PROJECT | Firestore 선호 벡터·`facility_embeddings` 읽기/쓰기 | 필수 |
| `roles/bigquery.dataEditor` | PROJECT | `congestion_logs` 스트리밍 인서트(WP2) | 런타임은 인서트만 → **테이블/데이터셋 레벨**로 축소 가능 |
| `roles/bigquery.jobUser` | PROJECT | 예측 lookup 쿼리/BQML 잡 실행 | 런타임은 forecast lookup 조회만. BQML **학습 잡은 배포/프로비저닝 시점**(`deploy.ps1:100,184`)에 owner가 수행 → 런타임 SA에는 과할 수 있음 |
| `roles/pubsub.publisher` | PROJECT | 점유 이벤트 발행(WP4) | 발행 주체가 별도 publisher **Cloud Run Job**(`provision_pubsub.py`)이면 런타임 API SA에는 **불필요** 후보 |
| `roles/pubsub.subscriber` | PROJECT | push 구독 소비(WP4 ingest) | push 구독은 OIDC로 직접 호출되며(서버→서버), pull subscriber 권한이 런타임에 필요한지 재검토 → **불필요** 후보 |
| `roles/storage.objectAdmin` | PROJECT | GCS 모델 읽기(WP1 폴백) + Dataflow temp/staging 쓰기(WP5) | **과대**. 런타임은 모델 객체 **읽기만** → `objectViewer`(또는 버킷 한정)로 강등 가능. objectAdmin은 삭제/ACL 변경까지 허용 |
| `roles/dataflow.worker` | PROJECT | Dataflow 워커 SA 실행(WP5) | Dataflow는 **별도 워커 SA**가 맡는 게 정석. Cloud Run 런타임 API SA에는 **불필요** 후보 |

### 4.3 권고

1. **전용 런타임 SA 생성**(컴퓨트 기본 SA 공용 중단):
   ```powershell
   gcloud iam service-accounts create induspot-runtime --display-name="InduSpot Cloud Run runtime" --project knudc-henryseo711
   # Cloud Run 배포 시 --service-account 로 지정:
   #   gcloud run deploy induspot-api ... --service-account=induspot-runtime@knudc-henryseo711.iam.gserviceaccount.com
   ```
2. **런타임에 꼭 필요한 역할만**: `secretmanager.secretAccessor`(시크릿 단위), `aiplatform.user`, `datastore.user`, `bigquery.jobUser`(조회용), `bigquery.dataEditor`(테이블 한정), `storage.objectViewer`(모델 버킷 한정). `pubsub.publisher/subscriber`·`dataflow.worker`·`storage.objectAdmin`은 **각각 전용 SA**(publisher Job SA / Dataflow 워커 SA)로 분리하거나 제거.
3. **프로젝트레벨 → 리소스/조건부로 강등**:
   - Secret Manager: 시크릿 리소스별 바인딩(5개 키에만 `secretAccessor`).
   - GCS: 모델 버킷(`induspot-models-6757`)에만 `objectViewer`.
   - BigQuery: `induspot` 데이터셋/테이블 레벨 바인딩.
4. **서비스별 `run.invoker` 분리**: 게이트웨이 backend-auth SA와 Pub/Sub push SA는 각자 별도 신원으로, 해당 Cloud Run 서비스에만 `run.invoker`를 부여한다(현재는 동일 컴퓨트 SA 공용).

> 본 런북은 분석만 수행한다. `grant_runtime_iam.py`는 **읽기만** 했고 수정하지 않았다(배포 깨짐 방지).
> 위 강등은 별도 변경으로, 데모 영향 검증 후 적용한다.

---

## 5. 무인증 공개 엔드포인트

### 5.1 검증된 사실

- 게이트웨이 OpenAPI(`apps/api/openapi-gateway.yaml` 전체, 211줄)에 **`securityDefinitions`/`security:` 블록이 전혀 없다.**
  모든 path가 `x-google-backend`만 갖고 인증 요건이 없다.
- 따라서 다음 엔드포인트가 인증 없이 공개된다:
  - `/predict`(`openapi-gateway.yaml:193`; 라우터 `predict.py:15`)
  - `/api/v1/forecast/congestion`·`/heatmap`(`openapi-gateway.yaml:161,177`; 라우터 `forecast.py:24,41`)
  - `/api/v1/voice/turn`(`openapi-gateway.yaml:65`; Gemini 호출 경로)
  - 기타 recommendations/feedback/preferences/infrastructures/admin 등도 동일.
- 설계상 1차 방어는 **Cloud Run 비공개(IAM) + 게이트웨이 backend-auth OIDC**다(`openapi-gateway.yaml:6-9`, `deploy.ps1:194-195`).
  즉 Cloud Run 자체는 `run.invoker`로 잠겨 있고, 외부는 게이트웨이를 통해서만 접근한다.
  그러나 **게이트웨이 자체는 누구에게나 열려 있어**, 게이트웨이 경유 호출은 무인증이다.
- 앱 레벨 인증은 일부 경로만 적용된다: 클라이언트 Supabase JWT는 `X-Supabase-Authorization` 헤더로 전달되고
  FastAPI `get_current_user`가 우선 확인한다(`openapi-gateway.yaml:7-9`). `/predict`·`/forecast`·`/voice/turn`은
  의도적으로 무인증 공개 조회다(`predict.py:17-19`, `forecast.py:11`).

### 5.2 현재 완화책(검증)

- **오토스케일 비용 상한**: `--max-instances=8`(`deploy.ps1:161`, 근거 주석 `:158-160`) — 기본 100에서 8로 제한해 대량 호출 시 비용 폭주를 막는다(8 × concurrency 80).
- **입력 상한**(`recommendations.py`): `utterance` `max_length=500`(`:371`), `candidates` `max_length=30`(`:374`), `current_name` `max_length=120`(`:373`), `limit` `ge=1, le=20`(`:264`). `/predict`도 `hour 0-23`, `day_of_week 0-6` 범위 검증(`predict.py:9-10`). `/forecast/heatmap`은 `hours` `ge=1, le=168`(`forecast.py:43`).
- **호출 타임아웃**(`config.py`): Vertex `5.0s`(`:31`), Gemini `8.0s`(`:39`), Embedding `6.0s`(`:70`) — 단건 비용/지연 상한.

### 5.3 권고

1. **게이트웨이 인증 추가**(공개 경로에 한 등급 방어):
   - **API key**: OpenAPI에 `securityDefinitions`(`type: apiKey`, `name: x-api-key`, `in: header`)를 추가하고 각 path에 `security`를 건다. 프론트는 키를 헤더로 전송. (남용 추적·차단 가능, 단 SPA 번들 노출 한계 있음.)
   - **OIDC/Firebase Auth JWT**: `securityDefinitions`에 `x-google-issuer`/`x-google-jwks_uri`로 Firebase/Supabase JWT 검증을 게이트웨이 레벨에서 강제. (조회용 공개 엔드포인트는 정책상 제외 가능.)
2. **레이트리밋/쿼터**: API Gateway managed service에 quota(분당 호출 상한)를 설정해 IP/키별 남용을 차단.
3. **Cloud Armor / 외부 LB**(선택): 게이트웨이 앞단에 WAF·IP 레이트리밋. 데모 규모에선 과할 수 있으나 운영 전환 시 권장.

---

## 부록: 사고 대응 — 키 유출 의심 시 즉시 회전 체크리스트

키/자격증명 유출이 의심되면(공개 저장소 푸시, 로그/스크린샷 노출, 디스크 탈취 등) 아래를 **순서대로 즉시** 수행한다.

1. **영향 범위 식별**: 어떤 키인가? (service_role=전권 → 최우선 / anon·NEXT_PUBLIC=공개 전제 → 낮음)
2. **발급처에서 회전/폐기**:
   - Supabase `service_role`·JWT Secret → 대시보드 Rotate(§1.1).
   - Kakao REST → 콘솔 재발급(§1.2).
   - GCP SA키 → `gcloud iam service-accounts keys delete <KEY_ID>`(§3.2).
   - Pinecone → 콘솔에서 revoke(쓰지 않으므로 폐기, §1.3).
3. **Secret Manager 새 버전 추가** + 이전 버전 `disable`(§1.5).
4. **Cloud Run 재배포**로 `latest` 픽업(`.\deploy.ps1 -Backend -SkipReseed`, §1.6).
5. **디스크 평문 파기**: 노출된 `.env`/SA키 파일 삭제, 로컬은 ADC+SM 또는 `.env.local`로 전환(§2.3).
6. **노출 경로 점검**:
   - git 이력 확인: `.gitignore`가 `.env*`·`*.env`·루트 SA키를 차단(검증됨)하나, `Docs/` 하위 키는 글롭 미적용 → `**/knudc-*.json` 패턴 추가(§3.2).
   - 만약 과거에 커밋된 적이 있다면 git history purge(`git filter-repo`) 후 force-push.
7. **로그/액세스 감사**: Cloud Logging·Supabase·Kakao 콘솔에서 회전 시점 전후 비정상 호출 점검.
8. **사후**: 장수명 키 → WIF/ADC 키리스 전환(§3.4)으로 재발 방지.
