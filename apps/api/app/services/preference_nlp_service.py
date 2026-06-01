"""자연어 선호 입력 → 구조화 선호로 변환하는 서비스 (Gemini 활용 극대화).

근로자가 "조용한 회의실이랑 전기차 충전되는 주차장이 좋아요" 처럼 **자연어로 말하면**
이 서비스가 그것을 추천 알고리즘이 쓰는 구조(선호 카테고리 + 속성 + 8차원 선호 벡터)로 바꾼다.

설계 원칙(프로젝트 공통):
- Gemini 호출은 타임아웃 + 폴백. GEMINI_ENABLED=False 또는 실패 시 한국어 키워드 규칙으로
  폴백해 데모가 절대 깨지지 않는다(항상 구조화 결과 반환).
- 환각 방지: 모델 출력은 허용된 카테고리/속성 enum 으로만 강제하고, 코드가 다시 검증한다.
- 결과 벡터는 기존 calculate_preference_similarity 가 그대로 쓰는 8차원 포맷이라
  추천 점수에 즉시 반영된다.
"""

import asyncio
import json
import math
from typing import Optional

import structlog

from app.core.config import settings
from app.services.tttv.preference import CATEGORY_VECTORS, get_category_average_vector

logger = structlog.get_logger()

# 서비스의 4개 표준 카테고리 (식당/주차장/회의실/휴게 공간).
# rest_area 는 predict_service.normalize_facility_type 에서 ML 버킷 loading_dock 으로 매핑된다.
VALID_CATEGORIES = ["cafeteria", "parking", "meeting_room", "rest_area"]
CATEGORY_KO = {
    "cafeteria": "식당",
    "parking": "주차장",
    "meeting_room": "회의실",
    "rest_area": "휴게 공간",
}

# 허용 속성 → 8차원 선호 벡터의 보정 차원 인덱스.
# (preference.py 의 features 보정과 동일 의미축: idx4=편의/채식, idx6=친환경/충전 …)
ATTR_DIM = {
    "vegetarian": 4,    # 채식/비건
    "convenience": 5,   # 간편/빠름
    "ev_charger": 6,    # 전기차 충전
    "quiet": 7,         # 조용함
}
VALID_ATTRIBUTES = list(ATTR_DIM.keys()) + ["near", "indoor"]  # near/indoor 는 벡터 보정 없이 요약/메타에만 사용

# 폴백용 한국어 키워드 규칙
_CATEGORY_KEYWORDS = {
    "cafeteria": ["식당", "밥", "점심", "끼니", "먹", "구내식당", "카페테리아", "메뉴", "한식", "중식", "양식", "분식"],
    "parking": ["주차", "차 ", "차를", "주차장", "전기차", "충전", "ev"],
    "meeting_room": ["회의", "회의실", "미팅", "컨퍼런스", "회의공간"],
    "rest_area": ["휴게", "쉬", "쉴", "낮잠", "안마", "수면", "라운지", "휴식", "잠깐"],
}
_ATTR_KEYWORDS = {
    "vegetarian": ["채식", "비건", "샐러드", "베지"],
    "convenience": ["간편", "빠른", "빨리", "빠르게", "테이크아웃", "포장"],
    "ev_charger": ["전기차", "충전", "ev"],
    "quiet": ["조용", "한적", "방해", "집중"],
    "near": ["가까", "근처", "가깝", "인근", "주변"],
    "indoor": ["실내", "지하", "비 안", "비안", "실내주차"],
}

_SYSTEM_INSTRUCTION = (
    "당신은 산업단지 근로자의 자연어 선호 발화를 구조화하는 분석기입니다. "
    "오직 입력 문장에 드러난 의도만 추출하고, 없는 사실은 추가하지 마세요. "
    "facility 카테고리는 반드시 [cafeteria, parking, meeting_room, rest_area] 중에서만 고르세요. "
    "속성은 반드시 [vegetarian, convenience, ev_charger, quiet, near, indoor] 중에서만 고르세요."
)

_model = None
_model_init_attempted = False


def _normalize(vec: list[float]) -> list[float]:
    sq = sum(x * x for x in vec)
    if sq <= 0:
        return [1.0 / math.sqrt(8)] * 8
    norm = math.sqrt(sq)
    return [x / norm for x in vec]


def build_preference_vector(preferred_categories: list[str], attributes: list[str]) -> list[float]:
    """파싱된 카테고리/속성으로 8차원 선호 벡터를 구성(추천이 그대로 사용하는 포맷)."""
    base = get_category_average_vector(preferred_categories)  # 이미 L2 정규화됨
    vec = list(base)
    for attr in attributes:
        dim = ATTR_DIM.get(attr)
        if dim is not None:
            vec[dim] += 0.3  # 해당 의미축 부스트
    return _normalize(vec)


def _build_summary(preferred_categories: list[str], attributes: list[str]) -> str:
    """폴백/표시용 결정적 한국어 요약."""
    cats = [CATEGORY_KO[c] for c in preferred_categories if c in CATEGORY_KO]
    attr_ko = {
        "vegetarian": "채식 가능",
        "convenience": "간편·빠른 이용",
        "ev_charger": "전기차 충전",
        "quiet": "조용한 곳",
        "near": "가까운 곳",
        "indoor": "실내",
    }
    attrs = [attr_ko[a] for a in attributes if a in attr_ko]
    if not cats and not attrs:
        return "선호 정보를 충분히 파악하지 못했어요. 다시 말씀해 주세요."
    cat_str = "·".join(cats) if cats else "공용 시설"
    attr_str = (", ".join(attrs) + " 선호") if attrs else "선호"
    return f"{cat_str} 중심으로 {attr_str}로 이해했어요."


def _keyword_fallback(text: str) -> dict:
    """Gemini 미사용/실패 시 한국어 키워드 규칙으로 구조화."""
    low = (text or "").lower()
    cats = [c for c, kws in _CATEGORY_KEYWORDS.items() if any(k in low for k in kws)]
    attrs = [a for a, kws in _ATTR_KEYWORDS.items() if any(k in low for k in kws)]
    return {"preferred_categories": cats, "attributes": attrs}


def _coerce(parsed: dict) -> dict:
    """모델/폴백 출력에서 허용 enum 만 남기고 중복 제거(환각·오타 방지)."""
    cats, seen = [], set()
    for c in parsed.get("preferred_categories", []) or []:
        c = str(c).strip().lower()
        if c in VALID_CATEGORIES and c not in seen:
            seen.add(c)
            cats.append(c)
    attrs, seen_a = [], set()
    for a in parsed.get("attributes", []) or []:
        a = str(a).strip().lower()
        if a in VALID_ATTRIBUTES and a not in seen_a:
            seen_a.add(a)
            attrs.append(a)
    return {"preferred_categories": cats, "attributes": attrs}


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
        logger.info("pref_nlp_model_initialized", model=settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("pref_nlp_model_init_failed", error=str(e))
        _model = None
    return _model


def _build_prompt(text: str) -> str:
    return (
        "다음 근로자 발화에서 선호를 추출해 JSON 으로만 답하세요.\n"
        '형식: {"preferred_categories": [...], "attributes": [...], "summary": "한국어 한 문장"}\n'
        "preferred_categories 는 [cafeteria, parking, meeting_room, rest_area] 중에서만, "
        "attributes 는 [vegetarian, convenience, ev_charger, quiet, near, indoor] 중에서만 고르세요.\n"
        "발화에 없는 항목은 넣지 마세요. summary 는 입력 내용만으로 1문장.\n\n"
        f"발화: \"{text}\""
    )


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
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("pref_nlp_generate_failed", error=str(e))
        return None


async def parse_preference(text: str) -> dict:
    """자연어 선호 문장을 구조화 선호로 변환.

    반환: { preferred_categories, attributes, summary, vector, is_fallback }
    어떤 경우에도 예외 없이 구조화 결과를 반환한다(폴백 보장).
    """
    text = (text or "").strip()
    parsed: Optional[dict] = None
    is_fallback = True

    model = _get_model()
    if model is not None and text:
        try:
            raw = await asyncio.wait_for(
                asyncio.to_thread(_generate_sync, model, _build_prompt(text)),
                timeout=settings.GEMINI_TIMEOUT_SECONDS,
            )
            if raw:
                parsed = raw
                is_fallback = False
        except asyncio.TimeoutError:
            logger.warning("pref_nlp_timeout", timeout=settings.GEMINI_TIMEOUT_SECONDS)
        except Exception as e:
            logger.warning("pref_nlp_unexpected_error", error=str(e))

    model_summary = None
    if parsed is not None:
        model_summary = parsed.get("summary") if isinstance(parsed.get("summary"), str) else None
        coerced = _coerce(parsed)
        # 모델이 카테고리를 하나도 못 뽑았으면 키워드 폴백으로 보강
        if not coerced["preferred_categories"]:
            kw = _coerce(_keyword_fallback(text))
            if kw["preferred_categories"]:
                coerced = kw
                is_fallback = True
    else:
        coerced = _coerce(_keyword_fallback(text))

    preferred_categories = coerced["preferred_categories"]
    attributes = coerced["attributes"]
    summary = model_summary or _build_summary(preferred_categories, attributes)
    vector = build_preference_vector(preferred_categories, attributes)

    logger.info(
        "preference_parsed",
        categories=preferred_categories,
        attributes=attributes,
        is_fallback=is_fallback,
    )
    return {
        "preferred_categories": preferred_categories,
        "attributes": attributes,
        "summary": summary,
        "vector": vector,
        "is_fallback": is_fallback,
    }
