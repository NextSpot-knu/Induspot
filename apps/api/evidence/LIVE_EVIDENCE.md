# InduSpot — GCP 라이브 실측 증거

> 이 파일은 capture_live_evidence.py가 생성한 실측 증거입니다.
>
> 재생성:
> ```
> cd apps/api
> python scripts/capture_live_evidence.py
> ```

- 캡처 시각(UTC): `2026-06-04T20:30:27.420683+00:00`
- 프로젝트: `knudc-henryseo711` / 리전: `asia-northeast3` / BQ 위치: `us-central1`
- 게이트웨이: `https://induspot-gateway-9t4vof78.uc.gateway.dev`

| 서비스 | 상태 | 핵심증거 | 확인시각 |
| --- | --- | --- | --- |
| Cloud Run + API Gateway | LIVE | HTTP 200 {'status': 'healthy', 'project': 'InduSpot API', 'environment': 'production'} | 2026-06-04T20:30:28.170136+00:00 |
| Vertex AI 예측 | LIVE | predicted_congestion=0.09557280964496434 | 2026-06-04T20:30:29.668527+00:00 |
| Gemini (voice/turn) | LIVE | action=details spoken="고향순대는 순댓국, 순대국밥, 모듬순대, 모듬수육을 대표 메뉴로 하고 있으며, 혼잡도는 28%이고 도보로 2분 거리에 있습니다." | 2026-06-04T20:30:32.498041+00:00 |
| BQML 예보(forecast/heatmap) | LIVE | source=bqml points=3528 | 2026-06-04T20:30:36.381826+00:00 |
| Cloud Run(describe) | LIVE | revision=induspot-api-00041-8b9 secrets=['GCS_BUCKET_NAME', 'JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'] | 2026-06-04T20:30:40.489879+00:00 |
| Secret Manager | LIVE | count=5 ['GCS_BUCKET_NAME', 'JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'] | 2026-06-04T20:30:41.968870+00:00 |
| Pub/Sub | LIVE | topics=['projects/knudc-henryseo711/topics/induspot-congestion'] subs=2 | 2026-06-04T20:30:45.663450+00:00 |
| Cloud Scheduler | LIVE | count=1 jobs=[{'name': 'induspot-publisher-cron', 'schedule': '*/10 * * * *', 'state': 'ENABLED'}] | 2026-06-04T20:30:47.827850+00:00 |
| Firestore | LIVE | location=asia-northeast3 type=FIRESTORE_NATIVE name=projects/knudc-henryseo711/databases/(default) | 2026-06-04T20:30:49.093716+00:00 |
| BigQuery(congestion_logs + forecast_lookup) | LIVE | logs={'cnt': '50679', 'facilities': '147', 'max_ts': '2026-06-04 20:30:14'} forecast={'cnt': '7056', 'max_computed': '2026-06-04 20:23:42', 'max_ft': '2026-06-06 20:00:00', 'min_ft': '2026-06-04 21:00:00'} | 2026-06-04T20:30:57.239721+00:00 |

상태 정의: LIVE=실제 호출 성공, PARTIAL=일부만 동작, UNAVAILABLE=응답하나 데이터 비어있음/만료, ERROR=호출 실패.

전체 구조화 결과는 `evidence.json` 참조.
