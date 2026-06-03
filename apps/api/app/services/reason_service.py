"""WP3 — Vertex AI Gemini로 추천 사유(한국어 1~2문장) 생성.

가드레일:
- 모든 외부 호출(Gemini)에 타임아웃 + 폴백. 실패/타임아웃 시 코드 템플릿 문자열로 대체해
  데모가 절대 깨지지 않게 한다.
- 환각 방지: 시스템 프롬프트로 "주어진 수치/사실만 사용, 새 숫자 생성 금지"를 강제.
- GEMINI_ENABLED=False(기본값) 또는 SDK 미설치 환경에서도 import/호출이 안전하게 동작
  (=항상 템플릿 폴백).

Gemini 통합 최적화(품질·신뢰성):
- GenerationConfig(top_p/candidate_count/max_output_tokens 명시)로 결정성·길이 안정화.
- system_instruction 을 번호 규칙 + few-shot 으로 강화(문장수/환각/출력형식 못박기).
- safety_settings(BLOCK_ONLY_HIGH)로 한국어 정상 발화 과차단 방지(폴백이 항상 타는 것 방지).
- 응답 파싱을 견고화(안전필터 차단 시 .text ValueError 흡수 + candidates parts 직접 수집,
  마크다운 펜스/감싼 따옴표/줄바꿈 정규화).
"""

import asyncio
import re
from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

_SYSTEM_INSTRUCTION = (
    "당신은 산업단지 근로자에게 시설 추천 사유를 알려주는 한국어 어시스턴트입니다.\n"
    "[규칙]\n"
    "1. 반드시 입력에 주어진 수치와 사실만 사용합니다.\n"
    "2. 입력에 없는 숫자/시설명/사실을 새로 만들거나 추정하지 않습니다(거리·가격·메뉴·운영시간 창작 금지).\n"
    "3. 입력값이 '정보없음'인 항목은 문장에서 언급하지 않습니다.\n"
    "4. 혼잡도(0~1)는 백분율로 환산해 말합니다(0.31 → 31%). 단, 입력에 없는 새 백분율을 지어내지 않습니다.\n"
    "5. 추천 시설 혼잡도가 0.75 이상이면 추천 표현을 쓰지 말고 '지금은 붐벼 대기가 길 수 있다'는 식으로 안내합니다.\n"
    "6. 마케팅·과장·이모지·영어·인사말·줄바꿈 없이, 평서체 한국어 1~2문장(공백 포함 90자 이내)으로만 답합니다.\n"
    "[예시]\n"
    "입력 예: 추천 시설 제2식당(혼잡도 0.31), 도보 4분, 예상 대기 3분 → 출력 예: 제2식당은 도보 4분·예상 대기 3분으로 혼잡도 31%라 비교적 여유가 있습니다.\n"
    "입력 예: 추천 시설 북카페(혼잡도 0.82), 도보 6분 → 출력 예: 북카페는 혼잡도 82%로 지금은 붐벼 대기가 길 수 있어요."
)

_model = None
_model_init_attempted = False
_gen_config = None       # GenerationConfig (lazy: _get_model 에서 1회 생성)
_safety_settings = None  # list[SafetySetting] (lazy)


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
        "아래 사실만 사용해 추천 사유를 한국어 1~2문장(90자 이내)으로 작성하세요. "
        "입력에 없는 숫자나 사실은 절대 추가하지 마세요.\n"
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
    global _model, _model_init_attempted, _gen_config, _safety_settings
    if _model_init_attempted:
        return _model
    _model_init_attempted = True

    if not settings.GEMINI_ENABLED:
        return None
    try:
        import vertexai
        from vertexai.generative_models import (
            GenerativeModel,
            GenerationConfig,
            HarmBlockThreshold,
            HarmCategory,
            SafetySetting,
        )

        vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
        # 사유는 '입력 수치의 한국어 재진술'이라 결정성 위주. top_p/candidate_count 명시,
        # 한국어 멀티바이트 절단 방지를 위해 max_output_tokens 헤드룸(192) 확보.
        _gen_config = GenerationConfig(
            temperature=0.2,
            top_p=0.9,
            candidate_count=1,
            max_output_tokens=192,
        )
        # 혼잡/식당 관련 한국어 정상 발화가 기본 안전필터에 과차단돼 .text 접근 불가→항상 템플릿 폴백
        # 되는 것을 방지(보안강화가 아니라 '폴백이 항상 타는' 안정성 결함 해소). 극단 유해입력은 여전히 차단.
        _safety_settings = [
            SafetySetting(category=c, threshold=HarmBlockThreshold.BLOCK_ONLY_HIGH)
            for c in (
                HarmCategory.HARM_CATEGORY_HARASSMENT,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            )
        ]
        _model = GenerativeModel(
            settings.GEMINI_MODEL,
            system_instruction=[_SYSTEM_INSTRUCTION],
        )
        logger.info("gemini_model_initialized", model=settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("gemini_model_init_failed", error=str(e))
        _model = None
    return _model


def _extract_text(resp) -> str:
    """resp.text 는 후보가 안전필터로 차단되거나 빈 Part 면 ValueError 를 던진다.
    프로퍼티 접근을 가드하고, 실패 시 candidates 의 parts 를 직접 수집해 부분 응답도 살린다."""
    try:
        t = getattr(resp, "text", "") or ""
        if t.strip():
            return t
    except Exception:
        pass
    try:
        for cand in (getattr(resp, "candidates", None) or []):
            content = getattr(cand, "content", None)
            for part in (getattr(content, "parts", None) or []):
                pt = getattr(part, "text", "") or ""
                if pt.strip():
                    return pt
    except Exception:
        pass
    return ""


def _clean_reason(raw: str) -> Optional[str]:
    """마크다운 펜스/감싼 따옴표/여분 줄바꿈을 제거해 카드 1줄 사유로 정규화."""
    s = (raw or "").strip()
    if not s:
        return None
    s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
    s = re.sub(r"\n?```$", "", s).strip()
    if len(s) >= 2 and s[0] in "\"'“「" and s[-1] in "\"'”」":
        s = s[1:-1].strip()
    s = " ".join(seg.strip() for seg in s.splitlines() if seg.strip())
    return s or None


def _generate_sync(model, prompt: str) -> Optional[str]:
    try:
        kwargs = {
            "generation_config": _gen_config
            if _gen_config is not None
            else {"temperature": 0.2, "max_output_tokens": 192},
        }
        if _safety_settings:
            kwargs["safety_settings"] = _safety_settings
        resp = model.generate_content(prompt, **kwargs)
        return _clean_reason(_extract_text(resp))
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
