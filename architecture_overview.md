# InduSpot 시스템 아키텍처 명세서

본 문서는 `induspot_gcp` 리포지토리에 구현된 소스 코드를 바탕으로 시스템 구조와 동작 로직을 객관적으로 기술한 문서입니다. 시스템은 Frontend, Proxy, Backend, Database 4개의 계층으로 구성되어 있습니다.

---

## 1. Frontend Layer
**위치:** `apps/web/`
**스택:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Kakao Maps SDK, Recharts
**배포:** Vercel

### 1-1. 주요 컴포넌트 및 페이지
*   **지도 렌더링 ([CongestionMap.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/components/map/CongestionMap.tsx))**
    *   Kakao Maps API를 사용하여 시설 위치 마커를 표시합니다.
    *   혼잡도 수치에 따라 마커 색상을 분기합니다 (0.7 이상 Red, 0.3 이상 Yellow, 그 외 Green).
    *   예상 대기 시간 클라이언트 연산 로직을 포함합니다: `혼잡도 * 평균 처리 시간 * 시간대 가중치`. (12~14시는 가중치 1.3배, 7시/15시는 1.2배 적용)
*   **추천 UI ([page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/worker/recommend/page.tsx))**
    *   API로부터 수신된 대안 시설 목록을 렌더링합니다.
    *   Kakao Maps API 키가 mock 상태일 경우 CSS 기반의 시뮬레이션 UI(Twin Node Active 레이더 뷰)를 렌더링하도록 예외 처리되어 있습니다.
    *   사용자의 수락/거절(accepted/rejected) 피드백 입력을 백엔드 API로 전송합니다.
*   **API 클라이언트 ([api-client.ts](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/lib/api-client.ts))**
    *   백엔드 통신 시, Supabase 세션에서 JWT를 추출하여 `Authorization` 헤더에 자동 주입합니다.
    *   Python(snake_case)과 JS(camelCase) 간의 네이밍 컨벤션 차이를 처리하기 위해 요청 페이로드와 응답 데이터를 재귀적으로 파싱하여 키 값을 상호 변환하는 헬퍼 함수가 구현되어 있습니다.

### 1-2. TTTV 추천 알고리즘 시뮬레이터
*   **위치:** [TTTVSimulator.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/components/admin/TTTVSimulator.tsx) 및 [page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/admin/simulator/page.tsx)
*   **목적:** 데이터베이스 및 API 서버에 의존하지 않고, 가중치 조합(선호도 가중치, 시간 비용 가중치, 혼잡 분산 인센티브 가중치)에 따른 1,000개 모의 시설 대상 점수 변화 및 군집 상태를 시각화 분석하는 관제 화면을 제공합니다.
*   **모의 시설 통계 분포 규칙:**
    *   **선호도 일치율 ($P$):** 양봉 분포(Bimodal Distribution)를 사용합니다. 30% 확률로 취향 일치 시설($U[0.8, 1.0]$), 70% 확률로 취향 불일치 시설($U[0.0, 0.2]$)을 모사합니다.
    *   **시간 비용 ($T$):** 비대칭 연속 분포(Asymmetric Continuous Skewed Distribution)를 사용합니다. 80% 확률로 인접 시설($U[0.1, 0.4]$), 20% 확률로 원거리 시설($U[0.4, 1.0]$)의 통근거리를 모사합니다.
    *   **혼잡 분산 보너스 ($I$):** 0점 스파이크 분포(Zero-Spike Distribution)를 사용합니다. 60% 확률로 인센티브 없음(0점), 40% 확률로 한산 보너스 제공($U[0.2, 0.8]$)을 모사합니다.
*   **가중치 자동 정규화 및 UI 연동:**
    *   사용자가 특정 가중치 입력창이나 슬라이더를 변경하면, 나머지 두 개 항목에 대한 기존 비율을 유지하며 총합이 $100\%$가 되도록 동적으로 비례 배분 및 정규화(Auto-normalization)합니다.
*   **점수 정규화 (Min-Max Scaling) 공식:**
    *   시간 비용 패널티의 감산 요소로 인해 발생하는 원본 점수 편향(음수 값 유입 및 낮은 상한값 제한)을 수정하고자, 가중치 합을 반영한 정규화 방식을 적용하여 점수를 `[0, 100]` 스케일로 출력합니다:
        $$Normalized\ Score = \max\left(0, \min\left(100, \frac{Raw\ Score + W_{time}}{W_{pref} + W_{time} + W_{inc}} \times 100\right)\right)$$
    *   연산 결과는 Recharts `AreaChart` 히스토그램으로 실시간 렌더링되며, 불균형 상태(U자 양극화, 극단적 거리 필터링, 인센티브 지향 등)에 따라 실시간 텍스트 리포트 분석 정보를 생성합니다.

### 1-3. 카카오맵 PC/모바일 하이브리드 길찾기 연동
*   **모바일 디바이스:** 사용자 User-Agent 분석을 통해 모바일 기기로 확인 시, 카카오맵 네이티브 앱을 즉시 실행하기 위한 `kakaomap://route?sp={start_lat},{start_lng}&ep={end_lat},{end_lng}&by=CAR` 스킴으로 강제 리다이렉트합니다.
*   **PC 환경:** 브라우저의 팝업 차단을 우회하기 위해 빈 탭을 선 생성한 후, 카카오 로컬 API `https://dapi.kakao.com/v2/local/geo/transcoord.json`를 호출하여 WGS84 좌표계를 카카오 내부의 `WCONGNAMUL` 좌표계로 변환합니다. 좌표 변환 성공 시 자동차 길안내 파라미터(`target=car`, `rt={sX},{sY},{eX},{eY}`)를 조립하여 카카오맵 웹으로 전송합니다. 좌표 변환 에러 및 API 장애 시, 명칭 매핑 방식(`https://map.kakao.com/?sName={start_name}&eName={end_name}`)으로 안전하게 폴백(Fallback)합니다.

### 1-4. 커스텀 Toast 알림 시스템 구현
*   기존 브라우저 네이티브 경고창(`alert`)을 대체하여 UI 방해 요소를 제거하고 비동기 피드백 가시성을 제고했습니다.
*   [globals.css](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/globals.css) 내 `@keyframes toast-in-up` 및 `.animate-toast` 트랜지션을 사용하여 부드럽게 위로 올라오는 토스트 팝업을 설계했습니다.
*   유저 페이지([page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/main/page.tsx)), 저장 목록([page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/saved/page.tsx)), 대안 추천 수락 화면([page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/worker/recommend/page.tsx))에 마운트되어 추천 수락/삭제/설정 변경 등의 상태 피드백을 전달합니다.

### 1-5. 프론트엔드 최적화 (성능 튜닝)
*   **데이터 페이징 조율:** 관리자 메인 화면 차트 데이터 리스트([DashboardCharts.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/components/admin/DashboardCharts.tsx)) 및 시설 관리 화면([page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/admin/infrastructure/page.tsx))의 테이블 렌더링 리소스 점유를 해소하고자 페이지당 조회 항목 수를 기존 20개에서 10개로 수정(`itemsPerPage = 10`)하여 렌더링 부하를 줄였습니다.
*   **초기 로드 데이터 축소:** 구미 음식점 원본 데이터셋([gumi_restaurants_grouped.csv](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/samples/gumi_restaurants_grouped.csv))을 대상으로 공간 좌표 정렬 후 고르게 샘플을 분산하여 샘플링하는 [shrink_restaurants.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/scratch/shrink_restaurants.py) 스크립트를 작성하여 적용했습니다. 이후 추가 감축을 통해 리스트 크기를 최종 103개 항목으로 경량화(약 1/12 이상 축소)함으로써 맵 컴포넌트 마운트 지연 시간 및 데이터 로딩 네트워크 대역폭을 단축했습니다.

---

## 2. Proxy Layer
**위치:** `apps/web/app/api/proxy/[[...path]]/route.ts`
**배포:** Vercel Serverless Functions

*   프론트엔드 클라이언트와 GCP Cloud Run API 서버 간의 요청을 중계 및 중개합니다.
*   **인증 및 토큰 중계 로직:**
    1.  서버 환경 변수 `GCP_SERVICE_ACCOUNT_KEY` JSON 구조를 파싱합니다.
    2.  `google-auth-library` 클라이언트를 구성하여 Cloud Run 리전별 백엔드 도메인을 대상으로 하는 GCP OIDC ID 토큰을 생성합니다.
    3.  생성된 OIDC 토큰을 프록시 요청 헤더 `Authorization`에 매핑하여 Cloud Run의 외부 인바운드 IAM 인증(`Cloud Run Invoker`)을 무사히 통과합니다.
    4.  클라이언트 웹 브라우저에서 전송했던 기존의 Supabase JWT 인증 헤더는 백엔드 서버에서 활용할 수 있도록 `X-Forwarded-Authorization` 헤더로 키 이름을 스위칭하여 안전하게 실어 보냅니다.
    5.  `GET`, `POST`, `PUT`, `DELETE`, `PATCH` 등의 모든 REST API 메서드를 다이나믹하게 수용하며 Next.js 15+ 규격에 맞게 `params: Promise` 처리를 완료하였습니다.

---

## 3. Backend Layer
**위치:** `apps/api/`
**스택:** Python 3.11, FastAPI, Uvicorn, Poetry
**배포:** GCP Cloud Run (컨테이너 기반)

### 3-1. 서버 구성 및 인프라 명세
*   **Dockerfile:** Python 3.11-slim 베이스 이미지를 활용하며, 의존성 경량화를 위해 Poetry 빌드 도구를 멀티 스테이지 빌드 형태로 격리 구성했습니다. 내부 포트 8080을 개방하여 구동합니다.
*   **환경 설정 관리 ([config.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/core/config.py)):** `pydantic-settings` 모듈을 이용하여 Supabase 접속 정보, JWT 대칭 키(`JWT_SECRET`), Pinecone API 키, GCS 모델 버킷 명칭 등 서버 실행 필수 파라미터들의 검증 및 바인딩을 강제합니다.

### 3-2. TTTV (Total Time to Value) 추천 알고리즘
*   **위치:** [score.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/services/tttv/score.py)
*   **대상 설정:** 사용자 기준 반경 150m 이내의 지리적 대안 시설 후보군을 탐색 대상으로 설정합니다.
*   **스코어 공식:**
    $$Score = (0.45 \times Preference) - (0.25 \times Time\ Cost) + (0.30 \times Incentive)$$
    *   **선호도 (Preference - w=0.45):** Pinecone 벡터 DB에서 로드한 사용자의 개인 선호 벡터와 대상 시설 카테고리 벡터 간의 코사인 유사도 점수입니다.
    *   **시간 비용 (Time Cost - w=0.25):** `(대안 시설 예측 대기 시간 + 도보 이동 시간) / 60` 값으로, 60분을 최대 패널티로 상정하여 `[0.0, 1.0]` 범위로 정규화한 뒤 감산합니다.
        *   **도착 시점 예측 로직:** 기존의 단순 실시간 혼잡도 대입 방식에서 벗어나, 사용자가 도보로 대안 시설까지 이동하는 시간(`travel_time_min`)을 먼저 계산한 뒤, **도착 예상 시점(현재 시각 + 이동 시간) 기준의 혼잡도 예측값**(`predict_congestion` 함수 실행 결과)을 Ridge Regression 모델에서 추출하여 예상 대기 시간(`predicted_wait`) 계산에 대입하는 구조를 갖추고 있습니다.
    *   **혼잡 분산 인센티브 (Incentive - w=0.30):** `원본 시설 혼잡도 - 대안 시설 혼잡도`로 수치를 측정하여, 분산 효과가 큰 여유 공간으로 갈수록 높은 점수를 가산합니다.
    *   종합 스코어는 최종적으로 `[0.0, 1.0]` 영역으로 클리핑 및 소수점 3자리 반올림되어 최종 결정됩니다.

### 3-3. 벡터 업데이트 로직 ([pinecone_service.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/services/pinecone_service.py))
사용자의 상호작용 피드백 데이터를 누적 반영하여 Pinecone 공간 내 8차원 사용자 선호도 벡터를 동적 갱신합니다.
*   **수락 (accepted) 피드백 수신:** `새 벡터 = 기존 벡터 + 0.1 * (선택 시설 벡터 - 기존 벡터)`
*   **거절/무시 (rejected/ignored) 피드백 수신:** `새 벡터 = 기존 벡터 - 0.05 * (선택 시설 벡터 - 기존 벡터)`
*   연산 완료 후, 벡터 크기를 일정하게 통일하기 위한 L2 정규화(Normalization) 작업을 수행한 후 Pinecone Index에 최종 Upsert를 진행합니다.

### 3-4. 혼잡도 예측 엔진 (Ridge Regression) 및 GCP GCS 연동
*   **모델 학습 스크립트 ([train.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/scripts/train.py)):**
    *   Supabase 데이터베이스에서 `facilities` 정보 및 `congestion_logs` 시계열 데이터 이력(총 140,004개 레코드)을 수집하여 가공합니다.
    *   유사 카테고리 병합 규칙을 가동하여 분류 기준을 정돈합니다 (`restaurant`/`cafe` -> `cafeteria`, `gym` -> `loading_dock`, `office` -> `meeting_room`).
    *   `scikit-learn` 패키지의 `OneHotEncoder`를 이용하여 `facility_type`, `hour`(0~23), `day_of_week`(0~6) 등의 핵심 변수들을 인코딩하며, 학습을 거쳐 예측 성능 $R^2 \approx 0.94$를 기록한 `sklearn.linear_model.Ridge(alpha=1.0)` 모델 객체 및 인코더를 `model.pkl` 직렬화 파일로 로컬에 추출합니다.
*   **모델 업로드 스크립트 ([upload_model.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/scripts/upload_model.py)):**
    *   로컬 개발 자격 증명(ADC) 파일(`application_default_credentials.json`) 내부를 읽어 GCP 프로젝트 ID(`knudc-henryseo711`)를 동적으로 추출합니다. GCS API를 매개하여 클라우드 버킷 `induspot-models-6757` 내부의 `models/model.pkl` 경로로 모델 바이너리 파일을 업로드합니다.
*   **인메모리 예측 서비스 ([predict_service.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/services/predict_service.py)):**
    *   FastAPI 인프라 구동 시 혹은 모듈 임포트 시, GCP GCS 서비스 계정 인증 흐름을 타며 GCS 버킷에 보관 중인 `models/model.pkl` 파일을 메모리 상으로 직접 로드하여 런타임 캐싱을 생성합니다. 만약 클라우드 연결 지연 및 단절 발생 시 로컬 파일 시스템 백업본으로 안전하게 스위칭되는 폴백 안정성이 기획되어 있습니다.
    *   예측 연산 수행 시 학습 데이터 스펙에 포함되지 않는 예외적인 시설 타입이 조회되면 즉시 중간 혼잡 값(`0.5`)을 출력하도록 안전 예외 처리를 추가했으며, 모델 출력 스케일을 `[0.0, 1.0]` 범위 내로 상시 클리핑 제어합니다.
*   **예측 전용 API 라우터 ([predict.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/routers/predict.py) 및 [main.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/api/app/main.py)):**
    *   `POST /predict` 엔드포인트를 열어 시설 타입, 시각(Hour), 요일(Day of week) 인풋을 받아 예상 혼잡도 수치를 JSON 객체로 실시간 회신합니다.

---

## 4. Database Layer

*   **Supabase (PostgreSQL):** 
    *   관계형 데이터 영역으로, 사용자 인적 정보(`users`), 실시간 하역장/회의실/식당/주차장 기초 좌표 메타데이터(`facilities`), 센서 수집 및 모의 주입을 통해 쌓이는 혼잡 정보 시계열 로그 테이블(`congestion_logs`)을 물리적으로 구동 및 제공합니다.
*   **Pinecone (Vector DB):**
    *   비정형 유사도 매칭 영역으로, 공단 노동자 개인 선호 및 각 시설 고유의 하드웨어 특성을 추상화한 8차원 공간 임베딩 벡터 데이터를 보관하고, 이를 토대로 코사인 유사도 검색을 보조합니다.

---

## 5. Congestion Logs Simulation & Seed Data

개발 테스트 환경 및 추천 정확도 검증 프로세스를 보조하기 위해 총 4가지 형태의 혼잡 시계열 가공 데이터 구축/제어 파이프라인을 운영하고 있습니다.

### 5-1. SQL 마이그레이션 시드 데이터
*   **위치:** [20250523120002_seed.sql](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/supabase/migrations/20250523120002_seed.sql)
*   **특징:** DB 초기화 직후 구동되는 PostgreSQL `generate_series` 기반 적재 시스템으로, 시설 종류별 고유한 통계적 혼잡 패턴을 가진 7일간의 시간대별 데이터베이스 초기 레코드를 생성합니다.
*   **카테고리별 핵심 패턴 상세:**
    *   **식당 (`cafeteria`):** 점심식사(11~13시) 및 저녁 피크타임(17~19시)에 혼합 확률 모델 형태로 높은 혼잡 수치($0.50 \sim 0.95$) 설정, 주말 최소 트래픽 배정. (수집 데이터 소스 종류: `cctv` 임시 지정)
    *   **주차장 (`parking`):** 평일 출근 직후 오전 피크타임(8~9시)에 임계 혼잡값 집중($0.75 \sim 0.95$), 평일 주간에는 업무 지속 유동 유지($0.65 \sim 0.80$), 심야시간대 감쇄. (수집 데이터 소스 종류: `iot_sensor`)
    *   **회의실 (`meeting_room`):** 주말 차단($0.0$) 조치, 평일 정규 업무시간대(9~17시) 유기적 변동량 부여. (수집 데이터 소스 종류: `access_card`)
    *   **하역장 (`loading_dock`):** 하적 차량 집중 시간대인 오전(8~11시, $0.60 \sim 0.95$) 및 오후(13~16시, $0.55 \sim 0.90$) 물류 혼잡 유도. (수집 데이터 소스 종류: `iot_sensor`)

### 5-2. Node.js 기반 벌크 로컬 시드 주입기
*   **위치:** [seed.js](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/scripts/seed.js)
*   **특징:** 로컬 및 스테이징 DB 환경 구축을 지원하는 스크립트 명령어로, 실행 시 과거 30일 범위의 로그 데이터를 벌크 데이터 형태로 대량 생성해 삽입합니다.
*   **최적화 구조:** 데이터베이스 트랜잭션 과부하 방지를 목적으로 당일 24시간 동안은 1시간 단위의 정밀 샘플 데이터를 생성하며, 이전 29일 영역은 3시간 단위의 주요 일과시간대 스냅샷 데이터를 주입합니다. 관리자 경보 시스템 등의 테스트를 돕기 위해 특정 시간(체육관 18:30 이후, 식당 12:00 전후)에 의도적으로 $90\%$를 초과하는 이상치(Anomaly) 혼잡 데이터를 인위 주입하는 특징이 있습니다.

### 5-3. Python 기반 실시간 랜덤 혼잡 로그 생성기
*   **위치:** [generate_logs.py](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/scratch/generate_logs.py)
*   **특징:** 일회성 실행용 유틸리티로, 현재 시간 기준 무작위 비율(여유 15개소: $0.05 \sim 0.28$, 보통 15개소: $0.35 \sim 0.65$, 혼잡 10개소: $0.72 \sim 0.95$)로 40개 전체 시설의 혼잡도를 재배치하여 실시간 라이브 대시보드 마이그레이션을 돕습니다.

### 5-4. 클라이언트 폴백 Mock 데이터 (Sandbox 모드)
*   **위치:** [page.tsx](file:///c:/Users/hennr/Desktop/InduSpot/induspot_final/induspot_gcp/apps/web/app/worker/recommend/page.tsx)
*   **특징:** DB 접근 및 API 통신이 지연되거나 개발용 격리 데모 환경 구동 시 프론트엔드가 중단되지 않도록 `MOCK_SEED_FACILITIES` 정적 객체를 보관하여 폴백을 구현합니다.
