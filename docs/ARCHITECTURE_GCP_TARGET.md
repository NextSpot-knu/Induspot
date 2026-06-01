# InduSpot — GCP 최대 활용 목표 아키텍처 & 전환 로드맵

> 작성일 2026-06-02. 이 문서는 "가능한 한 GCP 네이티브로" 아키텍처를 끌어올리기 위한 **목표상**과 **전환 경로**를 정의한다. 팀의 기존 `architecture_overview.md`(구현 서술)와 상호 보완하며, 그쪽을 대체하지 않는다.
>
> 평가축은 "동작 여부"가 아니라 **"GCP 서비스를 얼마나 제대로 썼는가"**다. 따라서 동작에 더해, 각 계층이 어떤 GCP 서비스 위에서 도는지가 코드·인프라에 드러나게 하는 것이 목표다.

---

## 0. 설계 원칙 (불변)

1. **폴백 우선** — 모든 외부 호출(Vertex/Gemini/BQ/Pub-Sub/Vector Search)은 타임아웃 + 다단 폴백. 클라우드가 죽어도 데모는 안 멈춘다.
2. **lazy 로딩** — 어떤 모델/엔드포인트도 import 시점에 죽지 않는다. 미설정이면 안전 폴백으로 기동.
3. **시그니처 불변** — `predict_congestion(facility_type, hour, day_of_week) -> float`, `pinecone_service`의 외부 함수 시그니처는 내부 백엔드를 바꿔도 유지.
4. **TTTV 가중치 보존** — `0.45 / 0.25 / 0.30`.
5. **API 응답 스키마 보존** — 필드 추가만 허용(snake_case ↔ camelCase 호환).
6. **시설 카테고리 4종** — cafeteria / parking / meeting_room / rest_area (ML 버킷은 매핑으로 보존).

---

## 1. 현재(검증된) 아키텍처 — 2026-06-02

```
[브라우저]
   │  Firebase Hosting (정적 export, apps/web/out)              ← Google ✅
   │
   ├─(A) Supabase 직접(anon)  → 지도/시설/대시보드 일부          ← 非GCP(Supabase)
   │
   └─(B) apiClient → API Gateway URL ……………… 🔴 게이트웨이 미배포(apigateway API off)
                                                  ⇒ 추천/피드백/선호 라이브 실패

[Cloud Run · asia-northeast3]                                   ← GCP ✅ (단, 2개 중복)
   · induspot-api      (정본)        · induspot-backend (잔재)
       │
       ├─ Vertex AI Endpoint (us-central1)  실시간 혼잡 예측      ← GCP ✅ (WP1)
       ├─ BigQuery + BQML (ARIMA_PLUS) 배치 예측 lookup          ← GCP ✅ (WP2)
       ├─ Vertex AI Gemini (2.5-flash-lite) 추천 사유/선호파싱    ← GCP ✅ (WP3)
       ├─ Pub/Sub push → /ingest/pubsub 이벤트 수집              ← GCP ✅ (WP4)
       ├─ GCS induspot-models-6757 (모델 아티팩트)               ← GCP ✅
       ├─ Supabase (Postgres + Auth/JWT)                        ← 非GCP
       └─ Pinecone (8차원 선호 벡터)                             ← 非GCP
```

**비-GCP 핵심 의존 = Supabase(데이터+인증), Pinecone(벡터), Kakao(지도).** 수집~AI/ML 계층은 이미 GCP 네이티브다.

---

## 2. 목표(GCP 최대) 아키텍처

```
[브라우저]
   │  Firebase Hosting (정적)                                   ← Google ✅
   │  인증: Firebase Auth / Identity Platform (Tier 3)          ← Google
   │
   └─ apiClient → API Gateway(us-central1) ── disable_auth로 JWT 전달 ──┐  ← GCP ✅(Tier1)
                                                                         ▼
[Cloud Run · induspot-api (단일)]  ── Secret Manager에서 비밀 로드 ──    ← GCP ✅(Tier1)
       ├─ Vertex AI Endpoint     실시간 예측                            ← GCP ✅
       ├─ BigQuery + BQML        배치 시계열 예측 + 대시보드 곡선         ← GCP ✅
       ├─ Vertex AI Gemini       사유/자연어 선호                        ← GCP ✅
       ├─ Firestore              8차원 선호 벡터(= Pinecone 대체, KV)   ← GCP ✅(Tier1)
       ├─ Vertex AI Vision       CCTV 점유 추정 → congestion_logs(cctv) ← GCP (Tier3)
       └─ 데이터: Cloud SQL(PostgreSQL)  (= Supabase 대체, Tier3)        ← GCP

[수집/스트림]
   Cloud Scheduler → Cloud Run Job(publisher) → Pub/Sub                ← GCP ✅(Tier2)
        → Dataflow(Beam) 윈도우 집계 → BigQuery 스트리밍 적재           ← GCP (Tier2)

[운영]  Cloud Build CI/CD · Cloud Logging/Monitoring/Trace · Terraform IaC  ← GCP (Tier2/3)
```

핵심 차이: **Pinecone·Supabase·산재 비밀을 GCP(Vector Search·Cloud SQL/Identity Platform·Secret Manager)로 흡수**하고, **비어 있던 스트림(2) 계층을 Dataflow로** 채운다.

---

## 3. 계층별 전환 매핑

| 계층 | 현재 | 목표(GCP) | GCP 서비스 | 노력/리스크 |
|------|------|-----------|-----------|------------|
| 1 수집 | Pub/Sub push + 수동 publisher | Cloud Scheduler + Cloud Run Job 자동 발행 | Pub/Sub, Scheduler, Run Jobs | 낮음 |
| 2 스트림 | **없음** | Pub/Sub → Dataflow 윈도우 집계 → BQ | Dataflow(Beam) | 중간 |
| 3 저장 | Supabase + **Pinecone** + GCS + BQ | **Firestore**(선호벡터 KV) / (Cloud SQL) / GCS / BQ | Firestore, Cloud SQL | 벡터=낮음, SQL=높음 |
| 4 AI/ML | Vertex Endpoint + BQML + Gemini | 좌동 + **Vertex AI Vision(CCTV)** | Vertex AI 전반 | Vision=중간 |
| 5 서비스 | Cloud Run + (깨진)Gateway + 산재 비밀 | Cloud Run + **API Gateway** + **Secret Manager** | Cloud Run, API Gateway, Secret Manager | 낮음~중간 |
| 6 클라이언트 | Firebase Hosting + Supabase Auth | Firebase Hosting + **Identity Platform** | Firebase Hosting, Identity Platform | 인증이관=높음 |
| 운영 | GitHub Actions, structlog | **Cloud Build** + Cloud Monitoring/Trace + Terraform | Cloud Build, Cloud Ops | 중간 |

---

## 4. 티어별 전환 로드맵

**Tier 0 — 이미 GCP (유지·검증)**
Cloud Run · GCS · Vertex Endpoint(WP1) · BigQuery+BQML(WP2) · Gemini(WP3) · Pub/Sub(WP4) · Firebase Hosting.

**Tier 1 — 이번 스코프(승인됨/진행 중) · 낮은 리스크, 즉효**
1. **API Gateway 정상화** ✅ — apigateway 활성화 + 스펙 정합 + 게이트웨이 배포(`induspot-gateway-9t4vof78.uc.gateway.dev`) + CI URL 교정. **Cloud Run은 비공개(IAM) 유지** — 게이트웨이가 backend-auth SA OIDC로 호출하고, 클라이언트 Supabase JWT는 `X-Supabase-Authorization` 헤더로 전달(공개 Cloud Run 회피, 더 안전). `/health` 200 검증.
2. **Firestore로 Pinecone 대체** ✅ 코드 완료 — 실사용이 ANN이 아니라 user_id별 8차원 벡터 KV 저장/조회라, Vector Search가 아니라 Firestore가 정확·안정적 대체재(인터페이스 유지, 내부만 교체). 진짜 ANN 데모가 필요하면 Vertex Vector Search는 별도 신규 기능으로.
3. **Secret Manager 일원화** — `config.py`가 이미 지원. Supabase/JWT/Pinecone 키를 Secret Manager로, Cloud Run 런타임이 로드.

**Tier 2 — 권장 추가 · 중간 노력, GCP 서사 강화**
4. **Dataflow 스트림** — 비어 있던 스트림 계층을 채움(Pub/Sub→Beam→BQ 스트리밍). 발표 임팩트 큼.
5. **Cloud Scheduler + Cloud Run Job 퍼블리셔** — 수동 `scratch/publish_events.py`를 관리형 크론 발행으로.
6. **Cloud Build CI/CD + Cloud Monitoring/Trace** — GitHub Actions를 Cloud Build로(또는 병행), 관측성 대시보드.

**Tier 3 — 최대치 · 대규모/선택 (로드맵)**
7. **Supabase → Cloud SQL(PostgreSQL)** + **Identity Platform**(Auth) — 가장 큰 비-GCP 의존 제거. 인증·RLS·마이그레이션 전면 영향 → 별도 프로젝트로.
8. **Vertex AI Vision(CCTV 점유 추정)** — SPEC 차별화 ①(현재 미구현). 영상→점유→`congestion_logs(source=cctv)`.
9. **Vertex AI Pipelines(MLOps)** + **Terraform IaC** — 재학습 자동화·인프라 코드화.

---

## 5. 권장 목표 & 시퀀싱

- **권장 목표 = Tier 0 + 1 + 2.** 달성 가능하면서 "수집·스트림·저장·AI/ML·서비스·클라이언트" 6계층이 전부 GCP로 채워지고, 비-GCP 핵심 의존은 Pinecone가 제거된다(Supabase는 Tier 3로 남김 — 리스크/비용 대비).
- **시퀀싱**: Tier1-1(Gateway, 크리티컬 패스) → Tier1-2(Vector Search) ∥ Tier1-3(Secret Manager) → Tier2-4(Dataflow) → Tier2-5/6 → (선택) Tier3.
- **Supabase 잔류 근거**: 인증·RLS·라이브 데이터가 모두 Supabase에 묶여 있어 이관 비용/리스크가 가장 크다. "GCP 최대"의 마지막 한 걸음으로 분리하고, 그 전까지는 Secret Manager·API Gateway 뒤에 두어 노출을 최소화한다.

---

## 6. 라이브 GCP 리소스(현황/예정)

| 리소스 | 이름/식별자 | 리전 | 상태 |
|--------|-------------|------|------|
| 프로젝트 | `knudc-henryseo711` | — | — |
| Cloud Run | `induspot-api` (정본) | asia-northeast3 | ✅ (`...to7m2nnlca-du.a.run.app`) |
| Cloud Run | `induspot-backend` | asia-northeast3 | ⚠️ 중복 → 정리 대상 |
| API Gateway | `induspot-gateway` → `induspot-gateway-9t4vof78.uc.gateway.dev` | us-central1 | ✅ 배포·/health 검증 (Option-2: 비공개 CR + backend-auth SA + X-Supabase-Authorization) |
| Vertex Endpoint | `2992545745120264192` | us-central1 | ✅ (WP1) |
| GCS | `induspot-models-6757` | — | ✅ |
| BigQuery | dataset `induspot` (+ARIMA_PLUS) | us-central1 | ✅ (WP2) |
| Pub/Sub | topic `induspot-congestion` (+push) | us-central1 | ✅ (WP4) |
| Firestore | DB `(default)` / `user_preference_vectors` | 멀티리전 | ⬜ Native 활성화 예정 (코드 완료) |
| Secret Manager | (예정) SUPABASE_*/JWT/PINECONE | — | ⬜ Tier1-3 |

> 가드레일: 위 전환은 모두 §0 원칙을 지킨다. 특히 Vector Search 이관은 `pinecone_service`의 외부 함수만 유지하면 `score.py`/`recommendations.py`가 무수정으로 동작한다.
