# InduSpot 시스템 아키텍처 개요 (AS-IS)

## 개요

InduSpot은 구미국가산업단지 근로자를 위한 공용 인프라(구내식당·주차장·회의실·휴게실) 실시간 혼잡 분산 추천 서비스입니다. 특정 시설이 혼잡할 때, 근로자의 개인 선호·이동 비용·혼잡 분산 효과를 종합한 TTTV(Time-To-Value) 점수로 도보권(150m) 대체 시설 최대 3곳을 추천하고, Gemini가 생성한 한국어 사유와 함께 제시합니다. 근로자는 추천 카드에서 만족도(👍/👎)를 남기며, 이 피드백은 Firestore의 8차원 선호 벡터를 즉시 보정해 다음 추천에 반영됩니다. GCP의 Vertex AI(혼잡 예측), BigQuery/BQML(시계열 예보), Pub/Sub(이벤트 수집), Firestore(선호 벡터)를 결합하되, 모든 외부 호출은 다단계 폴백(graceful degradation)을 적용해 외부 서비스가 불가용해도 데모/서비스가 멈추지 않도록 설계되었습니다. 핵심 가치는 (1) 산단 인프라 혼잡의 실시간 분산, (2) 개인화된 추천, (3) GCP 네이티브 ML 활용, (4) 회복탄력적(resilient) 아키텍처입니다.

---

## 시스템 구성도

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENTS (Browser)                              │
│   Worker App (/worker/*)                         Admin Dashboard (/admin/*)    │
│   - 인증: Supabase JWT                            - 인증: Firebase ID Token     │
└───────────────────────────────┬───────────────────────────┬───────────────────┘
                                 │                           │
                                 ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND — Firebase Hosting (Next.js 16.2.6 static export, apps/web/out)      │
│  App Router · CongestionMap(Kakao) · RecommendationCard · 클라 TTTV mirror      │
│  lib/api-client.ts (JWT 주입, camelCase↔snake_case) · lib/supabase.ts(anon,RLS)│
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 │  HTTPS  (X-Supabase-Authorization / Firebase)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  API GATEWAY (us-central1)  — openapi-gateway.yaml (Swagger 2.0)               │
│  backend-auth SA 의 OIDC 로 비공개 Cloud Run 호출 · Supabase JWT 헤더 포워딩    │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 │  OIDC (private IAM)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  BACKEND — Cloud Run  (induspot-api, asia-northeast3, FastAPI/Python 3.11)     │
│  routers: recommendations · preferences · predict · ingest · infrastructures   │
│  services: tttv/{score,preference,wait_time,travel} · predict_service          │
│            reason_service(Gemini) · preference_vector_service · *_nlp · bq_*    │
└──┬─────────┬──────────┬─────────┬─────────┬──────────┬─────────┬──────────┬─────┘
   │         │          │         │         │          │         │          │
   ▼         ▼          ▼         ▼         ▼          ▼         ▼          ▼
┌───────┐ ┌──────────┐ ┌───────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────┐ ┌─────────┐
│Supabase│ │Firestore │ │Vertex │ │BigQuery│ │Pub/  │ │Dataflow│ │Secret│ │  GCS    │
│Postgres│ │선호 벡터  │ │AI     │ │ +BQML  │ │Sub   │ │(stream)│ │Mgr   │ │model.pkl│
│(RLS)  │ │8-dim KV  │ │Endpoint│ │ARIMA+  │ │congest│ │ →BQ    │ │secret│ │ joblib  │
└───────┘ └──────────┘ └───────┘ └────────┘ └──────┘ └────────┘ └──────┘ └─────────┘
                            │                              ▲
                            ▼ (예측 실패 시 폴백)            │ (Cloud Scheduler */10)
                     GCS→local→0.5                  Cloud Run Job: publish_congestion

┌──────────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL                                                                       │
│   Kakao (Maps SDK / Mobility Directions)  ·  Gemini (Vertex AI, 2.5-flash-lite)│
│   Firebase Authentication (Identity Platform REST)                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Frontend 계층 (Firebase Hosting · Next.js static)

### 책임
- 근로자 앱(지도·추천)과 관리자 대시보드 UI 제공. 정적 익스포트(`output: 'export'`)로 서버 사이드 렌더링·Next.js API 라우트 없음 — 데이터 페칭은 서버 컴포넌트(빌드 시) 또는 클라이언트 `useEffect`에서 수행.
- 두 인증 모델 분리: 근로자=Supabase JWT, 관리자=Firebase ID Token(localStorage `induspot_admin_fb`).
- 백엔드 불가용 시 클라이언트 TTTV mirror + 목 시드 데이터로 데모 무중단.

### 스택
Next.js 16.2.6, React 19.2.4, App Router, Tailwind v4(`@tailwindcss/postcss`), `@supabase/supabase-js` 2.106.1, recharts 3.8.1, lucide-react, Kakao Maps SDK v2(`services,clusterer`), Firebase Auth REST.

### 핵심 파일 (repo-relative)
| 파일 | 역할 |
|---|---|
| `apps/web/app/layout.tsx` | 글로벌 레이아웃, Kakao Maps 스크립트 주입(`beforeInteractive`), 키 폴백 `NEXT_PUBLIC_KAKAO_MAPS_APP_KEY \| KAKAO_API_KEY \| KAKAO_MAP_KEY` |
| `apps/web/app/page.tsx` | 3초 스플래시 → `/setup` 리다이렉트 |
| `apps/web/app/worker/map/page.tsx` | 서버 컴포넌트, Supabase RLS 시설 목록+최신 혼잡 페칭, `MOCK_SEED_FACILITIES` 폴백, `revalidate=0` |
| `apps/web/app/worker/recommend/page.tsx` | **핵심 기능.** 콜드스타트 온보딩, TTTV 추천 흐름, 만족도 피드백, 카카오 길안내(모바일 `kakaomap://` / PC 좌표변환) |
| `apps/web/components/map/CongestionMap.tsx` | 전체 시설 카카오맵 시각화, 마커 클러스터링, 필터, 키 없으면 CSS 그리드 시뮬레이션 |
| `apps/web/components/RecommendationCard.tsx` | 단일 대안 카드(TTTV 분해·Gemini 사유·만족도·드래그·회의실 예약 모달) |
| `apps/web/app/admin/login/page.tsx` | Firebase REST 로그인, idToken/refreshToken localStorage 저장 |
| `apps/web/app/admin/layout.tsx` | 클라이언트 가드, `getAdminIdToken()` 검사 후 미인증 시 `/admin/login` |
| `apps/web/app/admin/dashboard/page.tsx` | KPI·히트맵·분포·이상알림, Supabase RLS 쿼리 + 클라 폴백 병합, CSV(BOM) 내보내기 |
| `apps/web/components/admin/{DashboardCharts,FacilityTable,SimulatePeakButton}.tsx` | 차트/시설표/피크 시뮬레이션 |
| `apps/web/lib/api-client.ts` | FastAPI HTTP 래퍼. `BASE_URL = NEXT_PUBLIC_API_GATEWAY_URL \| NEXT_PUBLIC_FASTAPI_URL \| /api/proxy`. JWT를 `Authorization`+`X-Supabase-Authorization`에 주입, camelCase↔snake_case 변환 |
| `apps/web/lib/supabase.ts` | `createPublicClient()` 싱글톤(anon 키, RLS 강제, service_role 없음) |
| `apps/web/lib/firebase-auth.ts` | 관리자 Firebase REST 인증, 만료 1분 전 자동 갱신(`securetoken.googleapis.com`) |
| `apps/web/lib/recommender.ts` | **클라이언트 TTTV mirror.** 동일 가중치(0.45/0.25/0.30) 점수화, `CATEGORY_VECTORS`(8차원), Haversine, 시간대 혼잡 배수, `buildReason` 한국어 사유, `rankFacilities` |
| `apps/web/lib/types.ts` / `apps/web/lib/utils.ts` | 테이블 인터페이스 / 마커 SVG(`getMarkerSvg`) |

### 동작
- 지도에서 시설 클릭 → 바텀시트 → "추천 받기" → `/worker/recommend?facilityId=X&lat=Y&lng=Z`.
- 추천 페이지 마운트 → `supabase.auth.getSession()` → `userId`(없으면 목 폴백). 추천 이력 개수=0이면 콜드스타트 온보딩(카테고리 3+개 또는 자연어 입력).
- 만족도 투표는 `votedRef.current`+`feedbackVotes`로 중복 방지, `mock-rec-id-*` 추천은 백엔드 호출 생략.
- 대시보드는 KST(UTC±9h) 변환, 오늘 로그 5건 미만이면 합성 데이터로 패널 공백 방지.

---

## 2. API Gateway 계층 (OIDC)

### 책임
브라우저 대상 단일 진입점(us-central1). `/api/v1/*` 및 `/predict`를 비공개 Cloud Run으로 라우팅하며, `backend-auth` 서비스 계정 OIDC로 백엔드를 호출하고 Supabase JWT를 `X-Supabase-Authorization` 헤더로 그대로 전달.

### 스택
Swagger 2.0, `x-google-backend`, backend-auth SA OIDC로 비공개 Cloud Run 호출. 게이트웨이 자체는 `securityDefinitions` 없이 공개이고, 인가는 백엔드 `get_current_user`(Supabase JWT)에 위임. 공개 노출 완화책은 `SECURITY.md §5`.

### 핵심 파일
- `apps/api/openapi-gateway.yaml` — 노출 경로: `/health`, `/api/v1/recommendations`, `/api/v1/feedback`, `/api/v1/preferences/parse`, `/api/v1/users/me/vector`, `/api/v1/infrastructures`, `/api/v1/admin/simulate-peak`, `/predict`.

### 동작
- 게이트웨이는 us-central1에만 배포 가능(asia-northeast3 미지원). Cloud Run 백엔드는 지연을 위해 asia-northeast3 유지 — 교차 리전 호출 허용.
- 배포 URL 예: `induspot-gateway-9t4vof78.uc.gateway.dev`. API Config 갱신 시 타임스탬프 접미사로 멱등 보장.

---

## 3. Backend 계층 (Cloud Run · FastAPI)

### 책임
혼잡 예측·시설 추천 엔진. 실시간 혼잡 데이터(Pub/Sub) 수집, TTTV 다요인 점수화, Vertex AI ML 예측, Gemini 사유 생성, Firestore 선호 벡터 관리. 모든 외부 의존성에 다단계 폴백 적용.

### 스택
FastAPI, Python 3.11, uvicorn, pydantic/`pydantic_settings`, structlog(JSON 로깅), supabase-py, PyJWT, `google-cloud-{aiplatform,pubsub,bigquery,firestore,storage,secretmanager}`, `google.oauth2.id_token`, vertexai(Gemini), httpx, asyncio.

### 핵심 파일
| 파일 | 역할 |
|---|---|
| `apps/api/app/main.py` | 앱 초기화, CORS(기본 와일드카드 / `ALLOWED_ORIGINS` 설정 시 strict), 라우터 등록. 헬스: `GET /`, `GET /health` |
| `apps/api/app/core/config.py` | pydantic Settings. `.env` 또는 Secret Manager 지연 로드. `GCP_PROJECT_ID=knudc-henryseo711`, `VERTEX_LOCATION=us-central1`, `BQ_LOCATION=us-central1`, `PUBSUB_TOPIC=induspot-congestion` 등 |
| `apps/api/app/core/supabase.py` | Supabase anon/service_role 클라이언트, Supabase JWT(HS256) 검증, Firebase 토큰 검증. `get_current_user`, `require_firebase_admin` 노출 |
| `apps/api/app/core/logging.py` | structlog JSON + GCP severity 매핑 |
| `apps/api/app/routers/recommendations.py` | `POST /api/v1/recommendations`(IDOR 보호 위치기반), `/recommendations/by-type`(타입 브라우징), `POST /api/v1/feedback`, `GET /api/v1/users/me/vector` |
| `apps/api/app/routers/preferences.py` | `POST /api/v1/preferences/parse`(자연어→구조화, Firestore 업서트, `users.preferred_categories` 갱신) |
| `apps/api/app/routers/predict.py` | `POST /predict`(무인증, Cloud Run IAM 보호): `{facility_type,hour,day_of_week}`→혼잡 |
| `apps/api/app/routers/ingest.py` | `POST /ingest/pubsub`(OIDC 검증, base64 파싱, `congestion_logs` 삽입, OrderedDict LRU 멱등 max 5000) |
| `apps/api/app/routers/infrastructures.py` | `GET /api/v1/infrastructures`(시설+최신 혼잡), `POST /api/v1/admin/simulate-peak`(Firebase 관리자 전용) |
| `apps/api/app/services/tttv/score.py` | TTTV 합성 점수, Min-Max 정규화 |
| `apps/api/app/services/tttv/preference.py` | 8차원 `CATEGORY_VECTORS`, 콜드스타트 평균, 코사인 유사도, 피처 가중(EV +0.3 idx6, vegetarian +0.2 idx4) |
| `apps/api/app/services/tttv/wait_time.py` | 대기시간 = 혼잡 × 기본처리시간 × 피크배수(12–14h 1.3×, 7h/15h 1.2×) |
| `apps/api/app/services/tttv/travel.py` | Haversine 직선거리 / Kakao Mobility Directions 폴백, 도보 66.67 m/min(4km/h) |
| `apps/api/app/services/predict_service.py` | 혼잡 예측 4단계 폴백(Vertex→GCS→local→0.5), 시설타입 정규화, 더블체크 락 지연 로딩 |
| `apps/api/app/services/reason_service.py` | Gemini(`gemini-2.5-flash-lite`) 한국어 사유, 환각 방지 시스템 지시, 4s 타임아웃·128토큰·temp 0.2, 120자 절단, 템플릿 폴백 |
| `apps/api/app/services/preference_vector_service.py` | Firestore 선호 벡터 KV: `get/upsert/adjust_user_vector_on_feedback`(accepted +10%, rejected/ignored −5%), L2 정규화 |
| `apps/api/app/services/preference_nlp_service.py` | 자연어→`{categories,attributes,summary,vector,is_fallback}`, Gemini JSON + 키워드 정규식 폴백 |
| `apps/api/app/services/bq_forecast_service.py` | BQML `congestion_forecast_lookup`(ARIMA_PLUS) 조회(대시보드용, 실시간 미사용) |
| `apps/api/app/jobs/publish_congestion.py` | Cloud Run Job, KST 시간대 인지 더미 혼잡 이벤트 생성→Pub/Sub 발행 |

### 동작
- 추천 시 후보 점수화·Gemini 사유·DB 저장을 모두 `asyncio.gather`로 병렬화. 동기 SDK는 `asyncio.to_thread`로 래핑.
- 후보 필터링: 원시설 제외, 150m Haversine 반경, TTTV 상위 N개(현재 5개, `top_n[:5]`).
- `by-type` 브라우징: 원시설 없음, 기준 혼잡 0.7로 인센티브 계산, `recommendations` 테이블에 미저장(합성 `bytype-{facility_id}`).

---

## 4. 추천 엔진 — TTTV (Time-To-Value)

### 정확한 공식 및 가중치
시설 후보의 원점수(raw)는 세 요인의 가중합:

```
raw = W1 · preference_similarity  −  W2 · time_cost  +  W3 · incentive

     W1 = 0.45  (선호 일치도, preference)
     W2 = 0.25  (시간 비용, time cost)
     W3 = 0.30  (혼잡 분산 인센티브, congestion incentive)
```

Min-Max 정규화(출력 [0,1]로 클램프):

```
score = (raw + W2) / (W1 + W2 + W3)   →  clamp([0, 1])
```

가중치는 황금비(45:25:30)로 하드코딩되어 런타임 튜닝 불가.

### 구성 요소 정의
- **preference_similarity**: 사용자 8차원 벡터와 시설 벡터의 코사인 유사도(둘 다 L2 정규화), [0,1] 클램프. 기준 벡터 — cafeteria `[1,0,0,0,0.2,0.1,0,0]`, parking `[0,1,0,0,0,0,0.3,0.1]`, meeting_room `[0,0,1,0,0.1,0,0,0.2]`, rest_area `[0,0,0,1,0,0.2,0,0]`. 피처 가중: EV 충전 +0.3(dim6), 채식 +0.2(dim4), 조용함 +0.3(dim7).
- **time_cost**: 도착 시점(UTC, `now + travel_time`) 예측 혼잡 기반 대기 + 이동 시간, `min(1.0, (wait+travel)/60)`.
- **incentive**: `max(0, original_congestion − candidate_congestion)`. **현재** 혼잡 사용.
- **의도적 시간 비대칭(설계 노트 `score.py`)**: time_cost는 **도착 시점 예측 혼잡**을, incentive는 **현재 혼잡**을 사용. 현재 떠날 동기(현재)와 미래 도착 조건(예측)을 균형.

### Gemini 사유
추천마다 `reason_service.generate_reason`가 Gemini(`gemini-2.5-flash-lite`)로 1–2문장 한국어 사유 생성. 시스템 지시로 "입력 수치만 사용, 새 숫자 생성 금지" 환각 가드. temperature 0.2, max 128토큰, 4s 타임아웃, 120자 절단. `GEMINI_ENABLED=False`(기본) 또는 타임아웃 시 결정적 템플릿(시설명+이동분+대기분+혼잡%) 폴백.

### 피드백 학습 (Firestore 벡터 보정)
사용자가 추천을 수락/거절/무시하면 `adjust_user_vector_on_feedback`이 Firestore 8차원 벡터를 즉시 보정:

```
accepted          : v_new = v_old + 0.10 × (v_facility − v_old)   (시설 쪽으로 +10%)
rejected / ignored: v_new = v_old − 0.05 × (v_facility − v_old)   (시설 반대로 −5%)
```

연산 후 L2 정규화하여 단위 벡터로 재저장(시간 감쇠 없음). 캐시 무효화 없이 **다음 추천 요청이 즉시 갱신된 벡터를 반영**.

### 콜드스타트
Firestore 벡터가 없으면 `users.preferred_categories`의 `CATEGORY_VECTORS` 평균(L2 정규화)을 즉시 생성·업서트. 카테고리도 없으면 균일 벡터 `[1/√8]×8` 사용.

---

## 5. End-to-End 데이터 플로우 (시퀀스)

### A. 추천 (Worker Recommendation)
1. 프론트 `POST /api/v1/recommendations {userId, originalFacilityId, userLat, userLng}` + Supabase JWT(`X-Supabase-Authorization`).
2. 게이트웨이 OIDC로 Cloud Run 호출 → `get_current_user`가 JWT(HS256, audience=authenticated) 검증, IDOR(body.userId == JWT sub) 확인.
3. 사용자·원시설·전체 시설(1000건 페이지네이션) 병렬 페칭, 150m 반경 후보 필터.
4. Firestore에서 사용자 선호 벡터 조회(없으면 콜드스타트).
5. 후보별 병렬: 최신 `congestion_logs` 조회, Haversine 거리, 도착 시각(UTC) 산출, 도착 시점 혼잡 예측(Vertex→GCS→local→0.5), 대기시간 계산, `calculate_tttv_score`.
6. TTTV 내림차순 상위 N개(현재 5개) 선택 → Gemini 사유 병렬 생성(4s, 템플릿 폴백).
7. `recommendations` 행 병렬 삽입 → `recommendation_id`·사유·시설정보 반환.
8. 프론트 3개 카드(미니맵·TTTV 분해·만족도·수락 CTA) 표시. 네트워크 오류 시 `buildMockRecommendations()` 폴백.

### B. 피드백 (Feedback Loop)
1. 👍/👎 또는 수락 CTA → `POST /api/v1/feedback {recommendationId, action}`.
2. 백엔드 소유권 가드(rec.user_id == JWT sub).
3. `user_feedback` 행 삽입. `accepted`면 `recommendations.accepted=True`.
4. 추천 시설의 `facility_vector`(CATEGORY_VECTORS + 피처) 로드 → `adjust_user_vector_on_feedback`(+10%/−5%) → Firestore 업서트.
5. 수락 시 카카오 길안내 오픈. "다른 옵션" 버튼은 3건 모두 `rejected` 제출 후 재추천(거절 시설 회피).

### C. 자연어 선호 (NL Preference Parsing)
1. 온보딩 모달 텍스트/음성 입력 → `POST /api/v1/preferences/parse {text}` + JWT.
2. `parse_preference`가 Gemini 호출(JSON 강제, enum 제약) → `{categories, attributes, summary(한국어), vector}`. 4s 타임아웃 시 키워드 정규식 폴백.
3. 환각 제거(enum coerce). 카테고리 평균 + 속성 차원 가중으로 8차원 벡터 구성.
4. Firestore 업서트 + `users.preferred_categories` 갱신 → `{is_fallback, vector_updated, categories_saved}` 반환.
5. 프론트 모달 닫고 새 벡터로 추천 재요청. 유효 속성 6종: vegetarian, convenience, ev_charger, quiet(차원 가중) / near, indoor(메타데이터만).

### D. 혼잡 예측 / 예보 (Prediction & Forecast)
1. TTTV 점수화 중 도착 시각 `now(UTC)+travel_time` → 도착 hour/dow 추출.
2. `predict_congestion(facility_type, hour, dow)` (블로킹, `to_thread`): 시설타입 정규화(restaurant/cafe→cafeteria, gym/rest_area/lounge→loading_dock, office→meeting_room).
3. 폴백 체인: (a) Vertex Endpoint(`VERTEX_ENDPOINT_ID` 설정 시, 5s 타임아웃, sklearn Pipeline OneHotEncoder→Ridge) → (b) GCS `models/model.pkl` 인메모리 → (c) local `model.pkl` → (d) 기본 0.5. 입력 불변식 `[norm_type, str(hour), str(dow)]`, source 로깅.
4. 대기시간 = `predicted_congestion × avg_process_time × hour_multiplier`(처리시간: cafeteria 20·parking 5·meeting_room/rest_area 10·loading_dock 30분).
5. **예보(배치)**: BQML ARIMA_PLUS가 48시간 예측을 `congestion_forecast_lookup`에 사전계산 → 관리자 대시보드 차트에서 조회(실시간 추천 경로에서는 절대 호출 안 함). `POST /predict`는 무인증(Cloud Run IAM)으로 대시보드·클라 데모 폴백 제공.

### E. 데이터 수집 (Pub/Sub / Dataflow)
1. 센서/CCTV/출입카드 → Pub/Sub 토픽 `induspot-congestion`에 base64 JSON `{facility_id, congestion, current_count, ts, source}` 발행.
2. Cloud Scheduler(`*/10 * * * *`) → Cloud Run Job `publish_congestion`이 KST 시간대 인지 더미 이벤트 발행(데모 시뮬레이션).
3. Push 구독 → `POST /ingest/pubsub` + OIDC Bearer 토큰.
4. OIDC 검증(`PUBSUB_PUSH_SERVICE_ACCOUNT` 이메일·`PUBSUB_PUSH_AUDIENCE` audience 설정 시) → base64 디코드 → 필드 검증.
5. LRU 멱등 검사(`_seen_message_ids` OrderedDict max 5000) → `congestion_logs` 삽입(service_role, RLS 우회) → 성공 후에만 processed 표시(일시 실패는 Pub/Sub 재전송). 4xx 반환 시 재시도 억제.
6. (병행) Pub/Sub → `/ingest/pubsub`(OIDC) → BigQuery `induspot.congestion_logs` **듀얼라이트**(FastAPI ingest)로 적재 → BQML 예보 학습 소스. (관리형 Dataflow 윈도우 집계는 별도 `congestion_windowed` 싱크 + opt-in `-WithStreaming` 이며 기본 수집 경로가 아님.) 추천 경로는 즉시 새 `congestion_level`을 `fetch_latest_congestion`으로 반영.

### F. Admin (대시보드 · 시뮬레이션)
1. 관리자 `POST /accounts:signInWithPassword`(Firebase REST) → idToken/refreshToken localStorage → `/admin/dashboard`.
2. 대시보드 로드: Supabase facilities(페이지네이션) + 오늘(KST) `congestion_logs` + 7일 `recommendations` + 오늘 `user_feedback` 병렬 페칭(anon SELECT, relax_dashboard_rls).
3. 24시간 히트맵: 시설×시간별 BQML `congestion_forecast_lookup` 조회, 실패/부족 시 KST 시간대 기반 의사난수 폴백 생성.
4. KPI(혼잡·수락률·DAU·이상알림) + 분포(30일) + 이상알림 렌더. 실데이터+합성 병합으로 패널 공백 방지.
5. `POST /api/v1/admin/simulate-peak`(Firebase 가드): 전체 시설 셔플 후 15 easy(0.05–0.28)·15 medium(0.35–0.65)·나머지 hard(0.72–0.95) 버킷 할당, 10건 단위 배치 삽입.
6. CSV 내보내기: 인메모리 생성, 한글 Excel용 BOM 접두.

---

## 6. 인증 · 보안

| 항목 | 내용 |
|---|---|
| **근로자 인증** | Supabase JWT(HS256, audience=`authenticated`). 프론트는 `Authorization`+`X-Supabase-Authorization` 헤더로 전송. 백엔드 `get_current_user`는 `Authorization` → `X-Supabase-Authorization`(로컬) → `X-Forwarded-Authorization`(게이트웨이) 순으로 추출. JWT의 `sub`만 user_id로 사용, `role` 클레임은 무시. |
| **관리자 인증** | Firebase Authentication / Identity Platform. ID 토큰을 `X-Admin-Authorization` 헤더로 전달, `require_firebase_admin`이 issuer=`securetoken.google.com/<GCP_PROJECT_ID>`, audience=`GCP_PROJECT_ID` 검증. 프로토타입에선 모든 Firebase 사용자를 관리자로 취급(세분 역할 없음). |
| **Cloud Run 비공개** | Cloud Run `induspot-api`는 IAM 보호 비공개. 모든 클라 접근은 API Gateway 경유, `backend-auth` SA OIDC로만 호출. |
| **IDOR 보호** | 추천 요청 body의 user_id가 JWT sub와 일치해야 함. 피드백도 `recommendation.user_id == current_user.id` 확인. |
| **Secret Manager** | 키: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `GCS_BUCKET_NAME`. Cloud Run 런타임 SA에 `secretAccessor`. 부팅 시 지연 로드(`load_gcp_secrets()`), 미존재 키는 조용히 `.env` 폴백. |
| **RLS** | Supabase Row-Level Security. `get_auth_user_info()`(SECURITY DEFINER, 재귀 방지)로 `users(role, company_name)` 조회. service_role=FOR ALL, authenticated=시설/혼잡 SELECT·본인 추천/피드백 INSERT/UPDATE, admin(`users.role='admin'`)=시설/로그 CRUD·동일회사 사용자 조회. anon(`20260602130000` 완화)=대시보드용 facilities/congestion_logs/recommendations/user_feedback SELECT 허용(프로토타입 양보). `congestion_logs` INSERT는 anon 차단 → ingest/simulate-peak는 service_role 사용. |
| **Pub/Sub OIDC** | 선택적(`PUBSUB_PUSH_SERVICE_ACCOUNT`/`PUBSUB_PUSH_AUDIENCE` 비면 생략). Cloud Run IAM이 1차 방어. |
| **CORS** | `ALLOWED_ORIGINS`=`['*']`/빈 값이면 와일드카드 + `allow_credentials=False`(CORS 표준 위반 방지). 명시 도메인이면 strict + credentials=True. |

---

## 7. 데이터 모델

### Supabase PostgreSQL 15 (`supabase/migrations/`)
| 테이블 | 주요 컬럼 | 비고 |
|---|---|---|
| `users` | id(UUID, refs auth.users), employee_id(UNIQUE), company_name, preferred_categories(JSONB), work_shift(CHECK morning/afternoon/night), role(CHECK worker/admin), created_at, updated_at | `updated_at` 트리거. role은 본인 수정 불가(권한상승 방지) |
| `facilities` | id, name, type(CHECK cafeteria/parking/meeting_room/rest_area), latitude/longitude(double), capacity, operating_hours(JSONB), features(JSONB) | 시드 41개, 중심 36.1198/128.3471. current_count 컬럼 없음(로그에서 추론) |
| `congestion_logs` | id, facility_id(FK), timestamp(UTC, now), current_count, congestion_level(double, CHECK 0–1), source(CHECK iot_sensor/cctv/access_card) | 복합 인덱스 (facility_id, timestamp DESC), Realtime publication |
| `recommendations` | id, user_id(FK), original_facility_id·recommended_facility_id(FK, ON DELETE SET NULL), tttv_score, score_breakdown(JSONB: travel_time/wait_time/preference/incentive), accepted(bool) | 감사·학습 이력 |
| `user_feedback` | id, user_id(FK), recommendation_id(FK ON DELETE CASCADE), action(CHECK accepted/rejected/ignored), timestamp(UTC) | 선호 학습 트리거 |
| `inquiries` | id, user_id(NULLABLE), user_name, type, title, content, status(CHECK new/in_progress/resolved), created_at, updated_at | anon INSERT 허용, DELETE 정책 없음(기본 거부) |
| `system_settings` | id(INT, CHECK id=1 단일행), maintenance_mode, notice_text, congestion_threshold(0–100), coldstart_weight(0–100), updated_at | 단일행 설계, upsert 패턴 |

마이그레이션: `20250523120000_init.sql`, `20250523120001_rls.sql`, `20250523120002_seed.sql`(168시간×시설 패턴), `20260531220000_add_inquiries_table.sql`, `20260601120000_tighten_inquiries_rls.sql`, `20260602120000_add_system_settings.sql`, `20260602130000_relax_dashboard_rls.sql`.

키 제약: enum은 CHECK(타입 미사용)로 마이그레이션 유연성 확보. JSONB는 알려진 키 가정(스키마 미강제). 정규 좌표 36.1198/128.3471 고정. `recommendations`는 ON DELETE SET NULL(이력 보존), `user_feedback`/`congestion_logs`는 CASCADE.

### Firestore (`user_preference_vectors`)
- 문서 키: `user_id`. 스키마: `{vector: float[8], type: 'user'}`.
- 8차원 L2 정규화 벡터. KV 조회 전용(ANN 검색 아님 — 코사인 유사도는 `tttv/preference.py`에서 계산).
- 피드백 학습(+10%/−5%)·콜드스타트 초기화. 불가용 시 graceful no-op(추천 차단 안 함).

---

## 8. 배포 · CI

| 항목 | 내용 |
|---|---|
| **프로젝트 / 리전** | GCP 프로젝트 `knudc-henryseo711`. Cloud Run=asia-northeast3 / Vertex·BigQuery·Pub/Sub·API Gateway=us-central1(ML 정렬). |
| **백엔드 배포** | `deploy.ps1 -Backend` → Cloud Build `--source` 컨테이너 빌드 → Cloud Run(`induspot-api`, asia-northeast3, 포트 8080). 배포 시 `--update-env-vars`(`VERTEX_ENDPOINT_ID`·`GEMINI_ENABLED`·`EMBEDDING_ENABLED`·`PUBSUB_PUSH_*`) + `--update-secrets`(Secret Manager 5비밀) 병합 주입. 라이브 rev `induspot-api-00020`. `apps/api/Dockerfile`은 Python 3.11 → pip 설치 흐름. |
| **GCP 프로비저닝(멱등)** | `deploy.ps1 -Provision`: `grant_runtime_iam.py`(런타임 SA 8역할) → `setup_secrets.py`(SM 5비밀) → `provision_firestore.py`(`(default)` DB) → `load_bq.py`(Supabase→BQ) + `provision_bigquery.py`(BQML 학습+`forecast_lookup`) → (배포 후) `provision_pubsub.py`(토픽·push구독·`induspot-publisher` Job·Scheduler). `_gcloud.py`가 `gcloud.cmd` 전체경로 해석(Windows). 전 단계 멱등·`*_OK` 마커. 런북=`docs/GCP_NATIVE_DEPLOY_RUNBOOK.md`. |
| **프론트 배포** | `.github/workflows/firebase-hosting.yml` — main 푸시 시 `npm ci` → `npm run web:build`(`NEXT_PUBLIC_API_GATEWAY_URL` 주입) → `firebase deploy --only hosting`. Node 20, npm 캐시. 정적 익스포트 `apps/web/out` → Firebase Hosting(`firebase.json`). |
| **ML 배포 스크립트** | `apps/api/scripts/deploy_vertex.py`(Vertex Model Registry, prebuilt sklearn-cpu.1-3, n1-standard-2, GCS `induspot-models-6757`), `scripts/{load_bq,provision_bigquery,_run_bqml}.py`+`sql/bqml_forecast.sql`(BQML ARIMA_PLUS, auto_arima·decompose·clean_spikes, 48h 예측), `scripts/seed_facility_embeddings.py`(Vertex 임베딩→Firestore), `scripts/deploy_publisher_job.py`(Cloud Run Job + Scheduler `*/10`), `dataflow/launch_dataflow.py`(Dataflow 스트리밍, opt-in). `congestion_logs` 스키마는 런타임 계약(`facility_id/congestion_level/current_count/source/timestamp`)으로 단일화. |
| **인증 정체성 주의** | gcloud CLI=Owner급(`projectIamAdmin`)이나 Python google-cloud 클라이언트는 ADC 사용. 프로비저닝은 BigQuery 권한을 부여한 SA 키로 ADC 고정, Pub/Sub 토픽/구독·`run.invoker`(프로젝트 레벨)는 gcloud(Owner)로 생성. |
| **버전 스큐 위험** | prebuilt sklearn-cpu.1-3(numpy 1.x) vs 로컬 numpy 2.x → `_extract_coef.py`+`_rebuild_and_deploy.py` 폴백 포함. |

---

## 9. 외부 의존성 & 폴백 전략 (Graceful Degradation)

핵심 설계 원칙: **단일 외부 서비스 장애가 추천을 차단하지 않는다.** 모든 사용자 대면 오류 메시지는 한국어(폴백 템플릿), 로그/코드는 영어(GCP 관측성).

| 의존성 | 1차 | 폴백 체인 |
|---|---|---|
| **혼잡 예측** | Vertex AI Endpoint(5s 타임아웃) | → GCS `model.pkl` 인메모리 → local `model.pkl` → 기본 0.5 |
| **사유 생성** | Gemini(`gemini-2.5-flash-lite`, 4s) | → 결정적 한국어 템플릿(시설명+이동분+대기분+혼잡%) |
| **백엔드 추천** | FastAPI `/recommendations` | → 클라이언트 TTTV mirror(`recommender.ts`, 동일 가중치) + 목 시드 데이터 |
| **타입 브라우징** | `/recommendations/by-type` | → 클라 mirror `rankFacilities` |
| **이동시간** | Kakao Mobility Directions(키 설정 시, 2s) | → Haversine 직선거리 × 4km/h(66.67 m/min) |
| **선호 벡터** | Firestore | → `get` None 반환, `upsert` no-op, 콜드스타트 `CATEGORY_VECTORS`로 계속 |
| **선호 NLP** | Gemini JSON 추출 | → 키워드 정규식 폴백(`is_fallback=true`) |
| **지도 SDK** | Kakao Maps SDK | → CSS 그리드 시뮬레이션(앱키 없거나 목일 때) |
| **대시보드 데이터** | Supabase 실데이터 | → KST 시간대 기반 의사난수 합성(패널 공백 방지) |
| **Secret 로드** | Secret Manager(Cloud Run `--update-secrets` 주입 + 부팅 `load_gcp_secrets`) | → `.env`(로컬) |
| **예보** | BQML `congestion_forecast_lookup`(라우트 `GET /api/v1/forecast/*` → `source:"bqml"`) | → `source:"unavailable"` → 클라 의사난수 히트맵 |
| **수집 적재** | `/ingest/pubsub` → Supabase `congestion_logs` + BigQuery 듀얼라이트 | BQ 실패해도 Supabase 적재·200·멱등 유지(best-effort) |
| **메뉴 의미검색(음성)** | Vertex 임베딩(`text-multilingual-embedding-002`) + Firestore `facility_embeddings` 코사인 | → Gemini 의도분류 → next 강등(폐기 안 함) |

비-GCP 의존성: Supabase(facilities/users/auth/logs 단일 진실 원천, Tier3 Cloud SQL 마이그레이션 대상), Kakao(Maps SDK + Mobility), Firebase Auth. **Pinecone는 deprecated**(Firestore KV로 대체, 시그니처만 호환 유지 — `available` False 시 graceful).

---

## 10. 현황 · 제약 노트

- **현황(2026-06-05 기준, 라이브 실측 — `apps/api/evidence/LIVE_EVIDENCE.md` 자동 캡처, 10/10 GCP 서비스 라이브)**: GCP-native 전환 완료. Cloud Run 라이브 리비전 `induspot-api-00041`(env: `VERTEX_ENDPOINT_ID`/`GEMINI_ENABLED`/`EMBEDDING_ENABLED`/`PUBSUB_PUSH_*` + Secret Manager 5비밀 마운트 — `gcloud run services describe`로 실측). 실측 증거(`scripts/capture_live_evidence.py`로 1커맨드 재현):
  - **WP1 Vertex 예측**: `/predict` → `{"predicted_congestion":0.0955,"source":"vertex"}` — 응답에 `source` 필드를 노출해 라이브 Vertex(Endpoint `2992545745120264192`)와 GCS/로컬 폴백을 구분(폴백 마스킹 제거).
  - **WP2 BigQuery/BQML**: ARIMA_PLUS(10분 로그를 시간단위 집계 학습) + `congestion_forecast_lookup`(7,056행/147시설, future_rows>0) → `GET /api/v1/forecast/{congestion,heatmap}` → `source:"bqml"` 라이브. **예보 만료(stale) 방지**: BigQuery 스케줄드 쿼리 `induspot-forecast-refresh`(12h)가 자동 재학습·재생성(`scripts/refresh_forecast.{sql,py}`·`setup_forecast_schedule.py`).
  - **WP3 Gemini**: `/api/v1/voice/turn` → 후보 데이터 기반 자연어 생성 라이브(예: "고향순대는 순댓국·순대국밥·모듬순대…혼잡도 28%, 도보 2분"). `GEMINI_ENABLED=true` + 런타임 SA `aiplatform.user`. 사유/음성/선호 NLP 경로 라이브.
  - **WP4 Pub/Sub**: 토픽 → push 구독(OIDC) → `/ingest/pubsub` → Supabase + **BigQuery `congestion_logs` 듀얼라이트**. Cloud Run Job `induspot-publisher` + Cloud Scheduler `induspot-publisher-cron`(`*/10`, ENABLED). E2E 라이브 실측: `congestion_logs` 50,000+행, `max_ts`가 매 10분 증가(10분 새 50,128→50,275).
  - **임베딩**: `EMBEDDING_ENABLED=true` + `EMBEDDING_SEEDED=1`(147시설, `facility_embeddings` 768차원 시드) → 음성 메뉴 의미검색 라이브.
  - **Firestore**: `(default)` Native DB(asia-northeast3) 라이브(선호 벡터 KV + 임베딩 캐시).
  - **Secret Manager**: 5비밀(`SUPABASE_*`/`JWT_SECRET`/`GCS_BUCKET_NAME`)을 Cloud Run `--update-secrets`로 마운트(`describe`에 `[secret:…/latest]` 실측) + 런타임 SA `secretAccessor` → 부팅 시 `.env` 의존 제거.
  - **API Gateway**: `induspot-gateway-9t4vof78.uc.gateway.dev`(`/health`·`/predict`·`/api/v1/forecast/*`·`/api/v1/diagnostics` 200).
  - **관측성/보안**: `GET /api/v1/diagnostics`(무인증)가 각 GCP 백엔드 와이어링+라이브를 self-report(`?probe=true`로 Vertex/BQML 라이브 프로브). 보안 하드닝 런북 = `SECURITY.md`(시크릿 회전·WIF·최소권한).
  - 활성화 자동화: `deploy.ps1`(상단 `$ProdEnvVars` 단일소스로 5키 주입). 런북 = `docs/GCP_NATIVE_DEPLOY_RUNBOOK.md`.
- **거의 완료**: ① 음성 메뉴 의미검색(Vertex 임베딩 `text-multilingual-embedding-002` + Firestore `facility_embeddings` 코사인) — **시드 완료(147시설, `seed_facility_embeddings.py`)** + `EMBEDDING_ENABLED=true`, rev `induspot-api-00020`로 인스턴스 재로드 → 라이브(시드 안 된 후보는 런타임 즉석 임베딩으로 보강). 한국 외식 택소노미로 단일 정밀분류(곱창집≠고깃집≠순댓국)로 귀착. ② 앱 데이터 주 저장소는 여전히 Supabase(facilities/users/recommendations); BigQuery/Firestore는 분석·예측·선호 용도로 공존.
- **런치 준비 완료(opt-in)**: Dataflow 5분 윈도우 집계(`Pub/Sub → 5분 FixedWindow 시설별 평균 → BigQuery congestion_windowed`) — `.venv_beam`에 `apache-beam[gcp]==2.59.0` 설치로 이전 `TableReference=None`(beam GCP extra 누락) 버그 해소(DirectRunner 5/5 통과). 전용 **PULL 구독 `induspot-congestion-dataflow`**(push 구독은 pull 불가 → 토픽 fan-out) + 런타임 SA `roles/dataflow.worker`·`roles/storage.objectAdmin` 추가. `deploy.ps1 -WithStreaming`로 런치(상시 과금; 데모 후 `gcloud dataflow jobs cancel`). 수집 자체(Pub/Sub→ingest→BQ 듀얼라이트)는 이미 라이브라 Dataflow는 보조 분석 계층.
- **인증 분리 비용**: 근로자=Supabase / 관리자=Firebase 이중 모델 → 백엔드가 두 헤더 스타일 처리. Firebase 관리자는 Supabase user 레코드가 없어 `admin_update_settings` RLS(`users.role='admin'`)와 불일치(프로토타입 허용, 프로덕션은 커스텀 클레임/동기화 필요).
- **멱등성**: Pub/Sub messageId LRU가 인스턴스 로컬(OrderedDict max 5000). 다중 인스턴스/재시작 시 중복 삽입 가능 → 프로덕션은 Firestore/Redis 권장.
- **TTTV 가중치 불변**: 0.45/0.25/0.30 하드코딩, 런타임 튜닝 불가. 시설 4종 고정(cafeteria/parking/meeting_room/rest_area), Ridge 모델은 3피처 원-핫에 적합. loading_dock는 정규화로 rest_area 매핑.
- **시간대**: 예측 모델 UTC 학습(Cloud Run 런타임 UTC), 대시보드는 KST 변환. `publish_congestion`은 KST 인지 분포.
- **anon RLS 완화**: 대시보드용 읽기 허용은 프로토타입 양보 — 프로덕션은 강화 필요.
- **정규 좌표 고정**: 모든 시드·CSV·프론트 기본 중심 36.1198/128.3471(구미). 회사별 시설셋은 스키마 재설계 필요.
- **샘플 데이터**: `samples/gumi_facilities.csv`, `gumi_parking*.csv`, `gumi_restaurants_grouped.csv`(주차 9·식당 16·회의실 8·휴게 6) — 실제 구미산단 POI.

> **GCP 최대화 로드맵은 `docs/ARCHITECTURE_GCP_TARGET.md` 를 참조하세요.**
