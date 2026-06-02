"""음성 응답 의도/선호 해석 — Vertex AI Gemini.

음성 비서가 추천 카드를 안내한 뒤, 사용자의 **자유발화 응답**을 받아 Gemini가 후보 시설
목록(이름/혼잡/거리)을 보고 다음 중 하나로 판단한다:
  - accept(수락·길안내) / next(다음) / reject(별로) / details(자세히) / stop(그만)
  - select: '양식 먹고 싶어'처럼 선호를 말하면 후보 **이름을 읽고 가장 잘 맞는 시설**을 골라
            target_facility_id 로 반환 → 추천을 그쪽으로 바꾼다(메뉴 차원이 없어도 동작).
또한 사용자에게 말할 한국어 응답(spoken)도 Gemini 가 생성한다(하드코딩 멘트 없음).

설계 원칙(프로젝트 공통): 타임아웃 + 폴백. GEMINI_ENABLED=False/실패/타임아웃 시 최소 키워드
규칙으로 action 만 분류해 데모가 안 멈추게 한다(사유 문장은 하드코딩하지 않는다).
"""

import asyncio
import json
from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

VALID_ACTIONS = ["accept", "next", "reject", "details", "select", "filter", "stop", "unknown"]
_WALK_M_PER_MIN = 66.67

_SYSTEM_INSTRUCTION = (
    "당신은 한국어 음성 비서의 의도 해석기입니다. 사용자가 추천받은 시설에 대해 말한 응답을 "
    "정확히 하나의 action 으로 분류하세요. 사용자가 특정 선호(예: 양식, 조용한 곳, 전기차 충전)를 "
    "말하면 주어진 후보 목록의 이름/특징을 보고 가장 잘 맞는 시설을 select 로 고르세요. "
    "반드시 주어진 후보 목록과 사용자 발화만 사용하고, 없는 시설·수치를 지어내지 마세요."
)

_model = None
_model_init_attempted = False


def _get_model():
    global _model, _model_init_attempted
    if _model_init_attempted:
        return _model
    _model_init_attempted = True
    if not settings.GEMINI_ENABLED:
        return None
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel

        vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
        _model = GenerativeModel(settings.GEMINI_MODEL, system_instruction=[_SYSTEM_INSTRUCTION])
        logger.info("voice_intent_model_initialized", model=settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("voice_intent_model_init_failed", error=str(e))
        _model = None
    return _model


def _build_prompt(utterance: str, facility_type_ko: str, current_name: Optional[str], candidates: list[dict]) -> str:
    lines = []
    for c in candidates:
        cong = c.get("congestion")
        dist = c.get("distance_m")
        cong_s = f"혼잡도 {round((cong or 0) * 100)}%" if isinstance(cong, (int, float)) else "혼잡도 정보없음"
        walk_s = f"도보 {max(1, round((dist or 0) / _WALK_M_PER_MIN))}분" if isinstance(dist, (int, float)) else "거리 정보없음"
        lines.append(f"- id={c.get('id')} | {c.get('name')} | {cong_s} | {walk_s}")
    cand_block = "\n".join(lines) if lines else "(후보 없음)"
    return (
        f"사용자는 '{facility_type_ko}' 추천을 음성으로 듣고 있습니다. 현재 추천: {current_name or '없음'}.\n"
        f"후보 목록:\n{cand_block}\n\n"
        f'사용자 발화: "{utterance}"\n\n'
        "아래 JSON 형식으로만 답하세요(다른 텍스트 금지):\n"
        '{"action":"accept|next|reject|details|select|filter|stop|unknown",'
        '"target_facility_id":"<select일 때 후보 id 하나, 아니면 null>",'
        '"match_ids":["<filter일 때 선호에 맞는 후보 id들(여럿 가능), 아니면 빈 배열>"],'
        '"spoken":"<사용자에게 말할 한국어 1문장(없는 수치 지어내지 말 것)>"}\n'
        "분류 규칙: 수락/가자/길안내 의사=accept. 다른 거/넘기기=next. 별로/싫어=reject. "
        "자세히/정보/얼마=details. 그만/취소/중지=stop. "
        "특정 한 곳을 콕 집으면(예: '두 번째 거', '저 식당') select 로 target_facility_id 를 채우세요. "
        "특정 종류·선호로 좁히면(예: '양식 먹고 싶어', '조용한 곳', '전기차 충전되는 데') filter 로 하고 "
        "후보 이름/특징을 보고 그 선호에 맞는 후보 id 들을 match_ids 에 모두 담으세요. "
        "어느 경우든 맞는 후보가 하나도 없으면 action=next 로 하고 spoken 에 그 사실을 안내하세요."
    )


def _fallback(utterance: str) -> dict:
    """Gemini 미사용/실패 시 최소 행동 분류(사유 문장·필터는 만들지 않는다 — spoken=None, match_ids=[])."""
    low = (utterance or "").lower()
    if any(k in low for k in ["그만", "됐어", "중지", "중단", "스톱", "멈춰"]):
        action = "stop"
    elif any(k in low for k in ["자세", "정보", "얼마", "대기", "거리", "도보"]):
        action = "details"
    elif any(k in low for k in ["별로", "싫"]):
        action = "reject"
    elif any(k in low for k in ["다음", "넘", "다른", "패스", "스킵", "말고"]):
        action = "next"
    elif any(k in low for k in ["응", "네", "그래", "좋아", "가자", "갈래", "여기", "안내", "수락", "콜"]):
        action = "accept"
    else:
        action = "unknown"
    return {"action": action, "target_facility_id": None, "match_ids": [], "spoken": None}


def _generate_sync(model, prompt: str) -> Optional[dict]:
    try:
        resp = model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.1,
                "max_output_tokens": 256,
                "response_mime_type": "application/json",
            },
        )
        raw = (getattr(resp, "text", "") or "").strip()
        return json.loads(raw) if raw else None
    except Exception as e:
        logger.warning("voice_intent_generate_failed", error=str(e))
        return None


def _coerce(parsed: dict, valid_ids: set) -> dict:
    """모델 출력에서 허용 action·후보 id 만 남긴다(환각 방지)."""
    action = str(parsed.get("action", "")).strip().lower()
    if action not in VALID_ACTIONS:
        action = "unknown"
    tid = parsed.get("target_facility_id")
    tid = tid if (isinstance(tid, str) and tid in valid_ids) else None
    # match_ids 는 유효 후보 id 만(중복 제거, 순서 보존)
    match_ids, seen = [], set()
    for m in (parsed.get("match_ids") or []):
        if isinstance(m, str) and m in valid_ids and m not in seen:
            seen.add(m)
            match_ids.append(m)
    # select 인데 유효 후보 id 가 없으면 next 로 강등(엉뚱한 선택 방지)
    if action == "select" and not tid:
        action = "next"
    # filter 인데 맞는 후보가 하나도 없으면 next 로 강등
    if action == "filter" and not match_ids:
        action = "next"
    spoken = parsed.get("spoken")
    spoken = spoken.strip()[:120] if isinstance(spoken, str) and spoken.strip() else None
    return {"action": action, "target_facility_id": tid, "match_ids": match_ids, "spoken": spoken}


async def interpret_turn(
    utterance: str,
    facility_type_ko: str,
    current_name: Optional[str],
    candidates: list[dict],
) -> dict:
    """음성 응답 1턴을 해석. 항상 {action, target_facility_id, spoken} 반환(폴백 보장)."""
    valid_ids = {c.get("id") for c in (candidates or [])}

    model = _get_model()
    if model is None or not (utterance or "").strip():
        return _fallback(utterance)

    try:
        raw = await asyncio.wait_for(
            asyncio.to_thread(_generate_sync, model, _build_prompt(utterance, facility_type_ko, current_name, candidates or [])),
            timeout=settings.GEMINI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("voice_intent_timeout", timeout=settings.GEMINI_TIMEOUT_SECONDS)
        raw = None
    except Exception as e:
        logger.warning("voice_intent_unexpected_error", error=str(e))
        raw = None

    if not raw:
        return _fallback(utterance)

    result = _coerce(raw, valid_ids)
    logger.info("voice_intent_resolved", action=result["action"], has_target=bool(result["target_facility_id"]))
    return result
