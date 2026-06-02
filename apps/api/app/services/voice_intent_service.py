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
    "정확히 하나의 action 으로 분류하세요. 사용자가 메뉴·종류·분위기 같은 선호(예: '짜장면 먹고싶어', "
    "'고깃집', '양식', '조용한 곳')를 말하면 select 가 아니라 filter 로 분류하세요 — 어떤 후보가 맞는지는 "
    "시스템이 의미검색으로 정합니다. 특정 한 곳을 콕 집을 때만(예: '저 식당', '두 번째 거') select 입니다. "
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
        cuisine = c.get("cuisine")  # 예: ['한식','순대'] / '양식' — 메뉴·종류 매칭에 사용
        if isinstance(cuisine, (list, tuple)):
            cuisine = ", ".join(str(x) for x in cuisine if x)
        cuisine_s = f" | 종류: {cuisine}" if cuisine else ""
        lines.append(f"- id={c.get('id')} | {c.get('name')}{cuisine_s} | {cong_s} | {walk_s}")
    cand_block = "\n".join(lines) if lines else "(후보 없음)"
    return (
        f"사용자는 '{facility_type_ko}' 추천을 음성으로 듣고 있습니다. 현재 추천: {current_name or '없음'}.\n"
        f"후보 목록:\n{cand_block}\n\n"
        f'사용자 발화: "{utterance}"\n\n'
        "아래 JSON 형식으로만 답하세요(다른 텍스트 금지):\n"
        '{"action":"accept|next|reject|details|select|filter|stop|unknown",'
        '"target_facility_id":"<select일 때 후보 id 하나, 아니면 null>",'
        '"match_ids":["<filter일 때 선호에 맞는 후보 id들(여럿 가능), 아니면 빈 배열>"],'
        '"search_query":"<filter일 때 의미검색용 한국어 검색어, 아니면 빈 문자열>",'
        '"spoken":"<사용자에게 말할 한국어 1문장(없는 수치 지어내지 말 것)>"}\n'
        "분류 규칙: 수락/가자/길안내 의사=accept. 다른 거/넘기기=next. 별로/싫어=reject. "
        "자세히/정보/얼마=details. 그만/취소/중지=stop. "
        "특정 한 곳을 콕 집으면(예: '두 번째 거', '저 식당') select 로 target_facility_id 를 채우세요. "
        "메뉴·종류·분위기 등 선호로 좁히면(예: '짜장면 먹고싶어', '고깃집', '양식', '조용한 곳') filter 로 하세요. "
        "filter 일 때는 search_query 에 사용자 선호를 한국 음식문화 상식으로 '구체적인 대표 메뉴(요리 이름)'로 확장해 넣으세요. "
        "예: '고깃집'→'삼겹살 갈비 목살 소고기 숯불구이 고깃집', '양식'→'파스타 스테이크 피자 양식', "
        "'분식'→'떡볶이 김밥 라면 분식', '짜장면 먹고싶어'→'짜장면 짬뽕 탕수육 중식', '곱창'→'곱창 막창 대창 곱창구이', "
        "'치킨'→'후라이드치킨 양념치킨 닭강정', '초밥'→'초밥 스시 사시미 회 롤'. "
        "요리 이름 위주로 확장하고(재료만 나열 금지), 서로 다른 인접 분류는 섞지 마세요: "
        "고깃집(삼겹살·갈비) / 곱창집 / 순댓국 / 보쌈집 / 치킨(후라이드·양념) / 닭갈비·찜닭 / 초밥·일식 / 해물·생선 은 각각 별개입니다. "
        "후보에 없는 메뉴라도 상식으로 확장하면 됩니다. "
        "정확한 매칭은 이 search_query 로 시스템이 의미검색해 정하므로, match_ids 는 비워 두어도 됩니다(보조용). "
        "spoken 에는 사용자 선호를 받아들이는 한국어 1문장을 담으세요."
    )


def _fallback() -> dict:
    """Gemini 미사용/실패 시 — 하드코딩 키워드 분류는 하지 않는다(의도/필터는 Gemini 전담).
    항상 unknown 을 반환해 프런트가 '다시 말씀해 주세요'로 재질문하게 한다(엉뚱한 동작 방지)."""
    return {"action": "unknown", "target_facility_id": None, "match_ids": [], "search_query": None, "spoken": None}


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
    # filter 는 여기서 강등하지 않는다. 어떤 후보가 맞는지는 라우터의 임베딩 의미검색이 정하고,
    # 벡터·Gemini 둘 다 빈값일 때만 라우터가 next 로 강등한다(선택지 폐기 아님, 우선순위만 조정).
    spoken = parsed.get("spoken")
    spoken = spoken.strip()[:120] if isinstance(spoken, str) and spoken.strip() else None
    # search_query: filter 일 때 임베딩 의미검색에 쓸 확장 검색어(고깃집→삼겹살·갈비…). 그 외엔 None.
    sq = parsed.get("search_query")
    sq = sq.strip()[:200] if isinstance(sq, str) and sq.strip() else None
    if action != "filter":
        sq = None
    return {"action": action, "target_facility_id": tid, "match_ids": match_ids, "search_query": sq, "spoken": spoken}


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
        return _fallback()

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
        return _fallback()

    result = _coerce(raw, valid_ids)
    logger.info("voice_intent_resolved", action=result["action"], has_target=bool(result["target_facility_id"]))
    return result
