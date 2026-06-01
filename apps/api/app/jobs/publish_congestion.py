"""Cloud Run Job — 더미 점유 이벤트를 Pub/Sub(induspot-congestion)로 1회 발행하고 종료.

WP4 수집 백본의 **관리형 퍼블리셔**. Cloud Scheduler 가 이 Job 을 주기적으로(예: */10 * * * *)
실행하면, push 구독이 /ingest/pubsub 로 전달해 congestion_logs 가 실시간 갱신된다.
(기존 수동 scratch/publish_events.py 를 대체 — 항상 켜둘 필요 없이 크론으로 구동.)

설계:
  - run-to-completion: 한 번 발행하고 exit 0 (반복 주기는 Scheduler 가 담당).
  - 폴백 우선: pubsub 미가용/시설 없음/자격 없음이면 로그만 남기고 정상 종료(데모 안전).
  - api 이미지 안에서 실행: `python -m app.jobs.publish_congestion` (app.core 의 설정/클라이언트 재사용).
"""

import json
import random
from datetime import datetime, timezone, timedelta

import structlog

from app.core.config import settings
from app.core.supabase import supabase_admin

logger = structlog.get_logger()


def _source_for(ftype: str) -> str:
    """시설 타입별 더미 소스(congestion_logs.source CHECK = iot_sensor|cctv|access_card)."""
    if ftype in ("parking", "rest_area", "loading_dock"):
        return "iot_sensor"
    if ftype == "meeting_room":
        return "access_card"
    return "cctv"


def _random_congestion(kst_hour: int, ftype: str) -> float:
    """시간대·타입을 약간 반영한 혼잡도(0~1). 점심/출퇴근 피크에 높게 치우치게."""
    peak = (
        (ftype == "cafeteria" and 11 <= kst_hour <= 13)
        or (ftype == "parking" and (8 <= kst_hour <= 10 or 17 <= kst_hour <= 19))
        or (ftype == "meeting_room" and 9 <= kst_hour <= 17)
    )
    night = kst_hour >= 22 or kst_hour < 7
    if night:
        return round(random.uniform(0.02, 0.2), 2)
    bucket = random.random()
    if peak:
        # 피크: 혼잡 쪽으로 치우침
        if bucket < 0.2:
            return round(random.uniform(0.3, 0.5), 2)
        return round(random.uniform(0.6, 0.95), 2)
    # 평시: 3구간 균형
    if bucket < 0.45:
        return round(random.uniform(0.05, 0.28), 2)
    if bucket < 0.8:
        return round(random.uniform(0.35, 0.65), 2)
    return round(random.uniform(0.72, 0.92), 2)


def load_facilities() -> list[dict]:
    try:
        res = supabase_admin.table("facilities").select("id, type, capacity").execute()
        return res.data or []
    except Exception as e:
        logger.warning("publisher_load_facilities_failed", error=str(e))
        return []


def main() -> int:
    try:
        # pyrefly: ignore [missing-import]
        from google.cloud import pubsub_v1
    except Exception as e:
        logger.warning("publisher_pubsub_unavailable", error=str(e))
        return 0  # 폴백: 데모 안전(비정상 종료로 Scheduler 재시도 폭주 방지)

    facilities = load_facilities()
    if not facilities:
        logger.info("publisher_no_facilities")
        return 0

    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(settings.GCP_PROJECT_ID, settings.PUBSUB_TOPIC)

    # KST 시각(브라우저TZ 무관하게 UTC+9)
    kst_hour = (datetime.now(timezone.utc) + timedelta(hours=9)).hour
    now_iso = datetime.now(timezone.utc).isoformat()

    futures = []
    for f in facilities:
        ftype = f.get("type", "")
        congestion = _random_congestion(kst_hour, ftype)
        capacity = f.get("capacity") or 100
        payload = {
            "facility_id": f["id"],
            "congestion": congestion,
            "current_count": int(capacity * congestion),
            "ts": now_iso,
            "source": _source_for(ftype),
        }
        futures.append(publisher.publish(topic_path, json.dumps(payload).encode("utf-8")))

    published = 0
    for fut in futures:
        try:
            fut.result(timeout=20)
            published += 1
        except Exception as e:
            logger.warning("publisher_publish_failed", error=str(e))

    logger.info("publish_congestion_done", topic=settings.PUBSUB_TOPIC, published=published, total=len(facilities))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
