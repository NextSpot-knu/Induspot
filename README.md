# InduSpot

산업단지(국가산업단지) 근로자를 위한 **공용 인프라 실시간 혼잡 분산 추천** 서비스입니다. 기준 단지는 구미국가산업단지(위도 36.1198 / 경도 128.3471)입니다.

## 개요

공단 내 4종의 공용 인프라 — **식당 / 주차장 / 회의실 / 휴게공간** — 의 혼잡도를 예측하고, 근로자가 실제로 **도착하는 시점**의 예상 혼잡을 기준으로 가장 적합한 장소를 추천합니다. 단순히 "지금 비어 있는 곳"이 아니라 이동 후 도착 시점에 쾌적할 곳을 안내하여, 특정 시설로의 쏠림을 분산합니다.

### TTTV 추천 점수

추천 순위는 **TTTV(Time-To-Target Value) 점수**로 결정됩니다.

```
TTTV = W1 · 선호도 − W2 · 시간비용 + W3 · 혼잡분산
     (W1 = 0.45,   W2 = 0.25,   W3 = 0.30)
```

- **선호도 (W1 = 0.45)** — 사용자가 선호하는 시설 유형/특성에 대한 가산점
- **시간비용 (W2 = 0.25)** — 현재 위치에서 해당 시설까지의 이동·대기 비용(클수록 감점)
- **혼잡분산 (W3 = 0.30)** — 도착 시점 예측 혼잡도가 낮을수록(분산에 기여할수록) 가산점

점수는 **도착 시점 혼잡 예측(predict_congestion)** 결과를 입력으로 사용해 산출됩니다.

## 모노레포 구조

```
Induspot/
├── apps/
│   ├── web/            # Next.js 16.2 — 근로자 앱 + 관리자 앱
│   └── api/            # FastAPI — 추천/혼잡예측 백엔드 (Cloud Run 배포)
├── packages/
│   └── shared-types/   # web ↔ api 공유 타입 정의
├── supabase/           # DB 스키마 / 마이그레이션
└── docker-compose.yml  # 통합 로컬 실행
```

> 루트에는 `app/` 디렉터리가 없습니다. 프론트엔드 코드는 모두 `apps/web` 하위에 있습니다.

## 실행법

### 웹 (근로자 앱 + 관리자 앱)

```bash
cd apps/web
npm run dev
```

### API (FastAPI / Cloud Run)

```bash
cd apps/api
poetry run uvicorn app.main:app --reload
```

### 통합 실행 (Docker)

```bash
docker-compose up --build
```

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프론트엔드 | Next.js 16.2 (근로자 앱 / 관리자 앱), TypeScript, Tailwind CSS |
| 백엔드 | FastAPI (Python), Poetry |
| 공유 | packages/shared-types (TypeScript 타입 공유) |
| 데이터 | Supabase |
| 혼잡 예측 | **Vertex AI**, **BigQuery ML (BQML)** |
| 추천/요약 | **Gemini** |
| 실시간 이벤트 | **Cloud Pub/Sub** |
| 배포 | **Cloud Run** |
