"""운영/심사용 진단 엔드포인트 — 각 GCP 백엔드의 '와이어링 + 라이브' 상태를 한 지점에서 노출한다.

목적: 배포된 서비스가 실제로 어떤 GCP 관리형 서비스를 '기본 실행경로'로 쓰는지(폴백이 아니라)를
self-report 한다. 감사에서 "코드는 라이브인데 외부에서 확인할 단일 지점이 없다"가 최대 약점이었으므로,
무인증 공개 GET 한 번으로 Vertex/Gemini/임베딩/BQML/Pub-Sub/Firestore 와이어링을 보여준다.

  GET /api/v1/diagnostics             : 설정(config) 기반 와이어링 상태만 (빠름, 외부호출 없음)
  GET /api/v1/diagnostics?probe=true  : 추가로 라이브 프로브(Vertex 1건 예측, BQML lookup 조회) 실행.
                                        외부 RPC가 있어 느릴 수 있고 미미한 비용이 발생하므로 opt-in.

인증: predict.py / forecast.py 와 동일한 무인증 공개 조회(1차 방어 = Cloud Run IAM run.invoker).
가드레일: 모든 프로브를 try/except 로 감싸 절대 죽지 않는다(부분 실패는 ok=false 로만 남긴다).
"""

from fastapi import APIRouter, Query

from app.core.config import settings

router = APIRouter(prefix="/api/v1", tags=["diagnostics"])


def _wiring() -> list[dict]:
    """설정값만으로 각 백엔드가 '활성 와이어링'인지 판정(외부호출 없음)."""
    return [
        {
            "service": "Vertex AI 혼잡예측 (WP1)",
            "gcp": "Vertex AI Online Prediction",
            "enabled": bool(settings.VERTEX_ENDPOINT_ID),
            "detail": (
                f"endpoint={settings.VERTEX_ENDPOINT_ID}, location={settings.VERTEX_LOCATION}"
                if settings.VERTEX_ENDPOINT_ID
                else "VERTEX_ENDPOINT_ID 미설정 → GCS/로컬 in-process 폴백"
            ),
        },
        {
            "service": "Vertex Gemini 추론 (WP3)",
            "gcp": "Vertex AI Gemini",
            "enabled": bool(settings.GEMINI_ENABLED),
            "detail": (
                f"model={settings.GEMINI_MODEL}"
                if settings.GEMINI_ENABLED
                else "GEMINI_ENABLED=false → 결정적 템플릿 폴백"
            ),
        },
        {
            "service": "Vertex 임베딩 의미검색",
            "gcp": "Vertex AI Text Embeddings + Firestore",
            "enabled": bool(settings.EMBEDDING_ENABLED),
            "detail": (
                f"model={settings.EMBEDDING_MODEL}, collection={settings.FIRESTORE_EMBEDDING_COLLECTION}"
                if settings.EMBEDDING_ENABLED
                else "EMBEDDING_ENABLED=false → Gemini match_ids 폴백"
            ),
        },
        {
            "service": "BigQuery / BQML 예보 (WP2)",
            "gcp": "BigQuery ML ARIMA_PLUS",
            "enabled": bool(settings.GCP_PROJECT_ID),
            "detail": f"{settings.BQ_DATASET}.{settings.BQ_FORECAST_TABLE} @ {settings.BQ_LOCATION} (배치 lookup; 실시간 1차경로는 WP1 Vertex)",
        },
        {
            "service": "Pub/Sub 수집 (WP4)",
            "gcp": "Cloud Pub/Sub push → /ingest/pubsub → BigQuery",
            "enabled": bool(settings.PUBSUB_PUSH_AUDIENCE),
            "detail": (
                f"OIDC audience={settings.PUBSUB_PUSH_AUDIENCE}, sa={settings.PUBSUB_PUSH_SERVICE_ACCOUNT}"
                if settings.PUBSUB_PUSH_AUDIENCE
                else "PUBSUB_PUSH_* 미설정 → OIDC 검증 생략(Cloud Run IAM 단독 방어)"
            ),
        },
        {
            "service": "Firestore 선호벡터",
            "gcp": "Cloud Firestore (Native)",
            "enabled": bool(settings.GCP_PROJECT_ID),
            "detail": f"db={settings.FIRESTORE_DATABASE}, collection={settings.FIRESTORE_COLLECTION}",
        },
    ]


def _probe_vertex() -> dict:
    """샘플 예측 1건으로 추론 '출처'를 확인. source==vertex 면 라이브 Vertex RPC."""
    try:
        from app.services.predict_service import predict_congestion_with_source

        value, source = predict_congestion_with_source("cafeteria", 12, 2)
        return {"ok": source == "vertex", "source": source, "sample_value": round(value, 4)}
    except Exception as e:  # noqa: BLE001 - 진단은 절대 죽지 않는다
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


def _probe_bqml() -> dict:
    """forecast lookup 에 '지금 이후' 예측 행이 있으면 BQML 라이브. 비어있으면 예보 만료."""
    try:
        from app.core.bigquery import query_forecast

        pts = query_forecast(facility_id=None, hours=24)
        return {
            "ok": len(pts) > 0,
            "rows": len(pts),
            "note": (
                "source=bqml 라이브"
                if pts
                else "lookup 비어있음(예보 만료) → scripts/refresh_forecast.sql 재실행 필요"
            ),
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


@router.get("/diagnostics")
def diagnostics(
    probe: bool = Query(
        False,
        description="라이브 외부 프로브(Vertex 1건 예측 + BQML lookup 조회) 실행. 외부 RPC라 느릴 수 있음.",
    ),
):
    out = {
        "service": settings.PROJECT_NAME,
        "env": settings.ENV,
        "project": settings.GCP_PROJECT_ID,
        "wiring": _wiring(),
    }
    if probe:
        out["live_probe"] = {
            "vertex": _probe_vertex(),
            "bqml": _probe_bqml(),
        }
    return out
