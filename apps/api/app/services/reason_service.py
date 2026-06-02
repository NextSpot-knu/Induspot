"""WP3 — Vertex AI Gemini로 추천 사유(한국어 1~2문장) 생성.

가드레일:
- 모든 외부 호출(Gemini)에 타임아웃 + 폴백. 실패/타임아웃 시 코드 템플릿 문자열로 대체해
  데모가 절대 깨지지 않게 한다.
- 환각 방지: 시스템 프롬프트로 "주어진 수치/사실만 사용, 새 숫자 생성 금지"를 강제.
- GEMINI_ENABLED=False(기본값) 또는 SDK 미설치 환경에서도 import/호출이 안전하게 동작
  (=항상 템플릿 폴백).
"""

import asyncio
from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

_SYSTEM_INSTRUCTION = (
    "당신은 산업단지 인프라 추천 사유를 작성하는 한국어 어시스턴트입니다. "
    "반드시 입력으로 주어진 수치와 사실만 사용하세요. "
    "입력에 없는 새로운 숫자나 사실을 절대 만들어내지 마세요. "
    "추천 시설의 혼잡도가 75% 이상이면 해당 시설을 추천하지 말고, 혼잡해 대기가 길 수 있음을 안내하세요. "
    "출력은 한국어 1~2문장, 80자 내외로 간결하게 작성하세요."
)

_model = None
_model_init_attempted = False


def _build_template(ctx: dict) -> str:
    """Gemini 없이도 항상 사용 가능한 결정적 폴백 문장."""
    name = ctx.get("recommended_facility_name") or "대안 시설"
    wait = ctx.get("predicted_wait")
    travel = ctx.get("travel_time")
    cand_cong = ctx.get("candidate_congestion")

    parts = []
    if isinstance(travel, (int, float)):
        parts.append(f"도보 {round(travel)}분")
    if isinstance(wait, (int, float)):
        parts.append(f"예상 대기 {round(wait)}분")
    if isinstance(cand_cong, (int, float)):
        parts.append(f"혼잡도 {round(cand_cong * 100)}%")

    # 혼잡(>=0.75)이면 추천하지 않고 혼잡·대기를 솔직히 안내한다.
    is_congested = isinstance(cand_cong, (int, float)) and cand_cong >= 0.75
    if parts:
        if is_congested:
            return f"{name}: " + ", ".join(parts) + " 수준으로 지금은 붐벼 대기가 길 수 있어요."
        return f"{name} 추천: " + ", ".join(parts) + " 수준으로 여유가 있습니다."
    if is_congested:
        return f"{name}은(는) 현재 혼잡해 대기가 길 수 있어요."
    return f"{name}을(를) 추천합니다."


def _build_prompt(ctx: dict) -> str:
    """입력 수치를 사실로 나열해 프롬프트 구성(모델이 새 숫자를 못 지어내도록 데이터만 제공)."""
    def fmt(v, suffix=""):
        if isinstance(v, (int, float)):
            return f"{round(v, 3)}{suffix}"
        return "정보없음"

    return (
        "다음 사실만 사용해 추천 사유 한 문장을 작성하세요.\n"
        f"- 원본 시설: {ctx.get('original_facility_name', '정보없음')} "
        f"(혼잡도 {fmt(ctx.get('original_congestion'))})\n"
        f"- 추천 시설: {ctx.get('recommended_facility_name', '정보없음')} "
        f"(혼잡도 {fmt(ctx.get('candidate_congestion'))})\n"
        f"- 도보 이동 시간: {fmt(ctx.get('travel_time'), '분')}\n"
        f"- 예상 대기 시간: {fmt(ctx.get('predicted_wait'), '분')}\n"
        f"- 선호 일치도(0~1): {fmt(ctx.get('preference'))}\n"
        f"- 혼잡 분산 기여도(0~1): {fmt(ctx.get('incentive'))}\n"
    )


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
        _model = GenerativeModel(
            settings.GEMINI_MODEL,
            system_instruction=[_SYSTEM_INSTRUCTION],
        )
        logger.info("gemini_model_initialized", model=settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("gemini_model_init_failed", error=str(e))
        _model = None
    return _model


def _generate_sync(model, prompt: str) -> Optional[str]:
    try:
        resp = model.generate_content(
            prompt,
            generation_config={"temperature": 0.2, "max_output_tokens": 128},
        )
        text = (getattr(resp, "text", "") or "").strip()
        return text or None
    except Exception as e:
        logger.warning("gemini_generate_failed", error=str(e))
        return None


async def generate_reason(context: dict) -> str:
    """추천 1건의 점수 구성요소를 받아 한국어 사유를 생성. 항상 문자열 반환(폴백 보장)."""
    template = _build_template(context)

    model = _get_model()
    if model is None:
        return template

    try:
        prompt = _build_prompt(context)
        text = await asyncio.wait_for(
            asyncio.to_thread(_generate_sync, model, prompt),
            timeout=settings.GEMINI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("gemini_timeout", timeout=settings.GEMINI_TIMEOUT_SECONDS)
        text = None
    except Exception as e:
        logger.warning("gemini_unexpected_error", error=str(e))
        text = None

    if not text:
        return template
    # 과도하게 길면 잘라서 데모 카드 레이아웃 보호
    return text if len(text) <= 120 else text[:117] + "..."
