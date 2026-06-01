"""WP4 — Pub/Sub push 구독 수신 엔드포인트.

POST /ingest/pubsub
  - Pub/Sub push 포맷({"message": {"data": base64, "messageId": ...}, "subscription": ...}) 파싱
  - message.data(base64) → JSON({facility_id, congestion, ts, source, current_count}) 디코드
  - congestion_logs 적재 (+ 멱등: messageId 중복 무시)

인증(가드레일): Pub/Sub push 가 실어 보내는 OIDC 토큰(Authorization: Bearer ...)을 검증한다.
  - settings.PUBSUB_PUSH_SERVICE_ACCOUNT 가 설정돼 있으면 토큰의 email 과 일치해야 한다.
  - settings.PUBSUB_PUSH_AUDIENCE 가 설정돼 있으면 audience 도 검증.
  - 둘 다 비어 있으면(개발 환경) 검증을 생략한다. (Cloud Run IAM run.invoker 가 1차 방어)

모든 처리는 실패해도 200 또는 명확한 4xx 를 반환해 Pub/Sub 재전송 폭주를 막는다.
"""

import base64
import json
from collections import OrderedDict

import structlog
from fastapi import APIRouter, Request, HTTPException, status

from app.core.config import settings
from app.core.supabase import supabase_client

logger = structlog.get_logger()
router = APIRouter(prefix="/ingest", tags=["ingest"])

# 멱등 처리: 인스턴스 로컬 LRU (프로덕션은 Firestore/Redis 등 외부 저장 권장)
_SEEN_MAX = 5000
_seen_message_ids: "OrderedDict[str, bool]" = OrderedDict()

_VALID_SOURCES = {"iot_sensor", "cctv", "access_card"}


def _already_processed(message_id: str) -> bool:
    if not message_id:
        return False
    if message_id in _seen_message_ids:
        return True
    _seen_message_ids[message_id] = True
    if len(_seen_message_ids) > _SEEN_MAX:
        _seen_message_ids.popitem(last=False)
    return False


def _verify_oidc(request: Request) -> None:
    """Pub/Sub push OIDC 토큰 검증. 실패 시 401."""
    expected_sa = settings.PUBSUB_PUSH_SERVICE_ACCOUNT
    expected_aud = settings.PUBSUB_PUSH_AUDIENCE
    if not expected_sa and not expected_aud:
        return  # 개발 환경: 검증 생략 (Cloud Run IAM 이 1차 방어)

    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC bearer 토큰 누락")
    token = auth.split(" ", 1)[1]

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests

        claims = id_token.verify_oauth2_token(
            token,
            g_requests.Request(),
            audience=expected_aud or None,
        )
    except Exception as e:
        logger.warning("pubsub_oidc_verify_failed", error=str(e))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC 토큰 검증 실패")

    if expected_sa and claims.get("email") != expected_sa:
        logger.warning("pubsub_oidc_sa_mismatch", got=claims.get("email"), expected=expected_sa)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="허용되지 않은 서비스 계정")


def _parse_push_payload(body: dict) -> dict:
    message = body.get("message")
    if not message or "data" not in message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pub/Sub push 포맷이 아닙니다.")
    try:
        decoded = base64.b64decode(message["data"]).decode("utf-8")
        return {"message_id": message.get("messageId", ""), "payload": json.loads(decoded)}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"메시지 디코드 실패: {e}")


@router.post("/pubsub")
async def ingest_pubsub(request: Request):
    _verify_oidc(request)

    body = await request.json()
    parsed = _parse_push_payload(body)
    message_id = parsed["message_id"]
    payload = parsed["payload"]

    if _already_processed(message_id):
        logger.info("pubsub_duplicate_ignored", message_id=message_id)
        return {"status": "duplicate_ignored"}

    facility_id = payload.get("facility_id")
    congestion = payload.get("congestion")
    if facility_id is None or congestion is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="facility_id/congestion 누락")

    source = payload.get("source")
    if source not in _VALID_SOURCES:
        source = "iot_sensor"  # CHECK 제약(iot_sensor|cctv|access_card) 위반 방지

    row = {
        "facility_id": facility_id,
        "congestion_level": max(0.0, min(1.0, float(congestion))),
        "current_count": int(payload.get("current_count", 0)),  # NOT NULL 컬럼
        "source": source,
    }
    if payload.get("ts"):
        row["timestamp"] = payload["ts"]

    try:
        import asyncio

        await asyncio.to_thread(
            supabase_client.table("congestion_logs").insert(row).execute
        )
    except Exception as e:
        logger.error("pubsub_ingest_insert_failed", error=str(e), facility_id=facility_id)
        # 5xx 를 주면 Pub/Sub 가 재전송 → 일시 장애엔 적절하나 영구 오류엔 폭주.
        # 여기서는 500 으로 재시도 유도(멱등 처리로 중복은 방어됨).
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="적재 실패")

    logger.info("pubsub_ingested", facility_id=facility_id, congestion=row["congestion_level"], source=source)
    return {"status": "ok", "facility_id": facility_id}
