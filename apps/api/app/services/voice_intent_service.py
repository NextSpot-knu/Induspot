"""음성 응답 의도/선호 해석 — Vertex AI Gemini.

음성 비서가 추천 카드를 안내한 뒤, 사용자의 **자유발화 응답**을 받아 Gemini가 후보 시설
목록(이름/혼잡/거리)을 보고 다음 중 하나로 판단한다:
  - accept(수락·길안내) / next(다음) / reject(별로) / details(자세히) / stop(그만)
  - select: '양식 먹고 싶어'처럼 선호를 말하면 후보 **이름을 읽고 가장 잘 맞는 시설**을 골라
            target_facility_id 로 반환 → 추천을 그쪽으로 바꾼다(메뉴 차원이 없어도 동작).
또한 사용자에게 말할 한국어 응답(spoken)도 Gemini 가 생성한다(하드코딩 멘트 없음).

설계 원칙(프로젝트 공통): 타임아웃 + 폴백. GEMINI_ENABLED=False/실패/타임아웃 시 최소 키워드
규칙으로 action 만 분류해 데모가 안 멈추게 한다(사유 문장은 하드코딩하지 않는다).

Gemini 통합 최적화(품질·신뢰성):
- response_schema(JSON Schema)로 action enum/타입/필수키를 디코딩 단계에서 강제 → 파싱 취약성 제거.
- 견고한 텍스트 추출(_extract_text: 안전필터 차단/빈 Part 시 .text ValueError 흡수 + candidates parts)
  + 펜스/잡텍스트/부분 JSON 복구 파서(_parse_json) + 비-dict 가드(AttributeError 크래시 방지).
- system_instruction 번호 규칙 강화 + few-shot 으로 filter↔select↔details 경계·환각 억제.
- safety_settings(BLOCK_ONLY_HIGH)로 한국어 정상 발화 과차단 방지.
"""

import asyncio
import json
import re
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
    "시스템이 의미검색으로 정합니다. 특정 한 곳을 콕 집을 때만(예: '저 식당', '두 번째 거') select 입니다.\n"
    "[엄격한 규칙]\n"
    "1. 출력은 지정된 JSON 객체 '하나'뿐. 코드펜스(```)·주석·앞뒤 설명을 절대 붙이지 마세요.\n"
    "2. 후보 목록에 없는 시설명·id·가격·영업시간·평점 등 어떤 수치/사실도 만들지 마세요. "
    "목록에 있는 종류·대표메뉴·혼잡도·도보시간만 사용하세요.\n"
    "3. target_facility_id 와 match_ids 는 반드시 주어진 후보 id 중에서만 고르세요(없으면 null/빈 배열).\n"
    "4. 발화 의도가 불명확하면 추측하지 말고 action 을 'unknown' 으로 두세요.\n"
    "5. 모든 한국어 출력은 정중한 '~요/습니다' 체 1~2문장으로, 영어·이모지·마크다운 없이 작성하세요.\n"
    "6. details 의 spoken 은 빈말 금지 — 위 후보의 실제 데이터(종류·대표메뉴·혼잡도·도보)를 근거로 답하세요."
)

# 시드 정밀분류(seed_facility_embeddings._TAXONOMY 라벨)와 '정확히' 일치해야 filter_candidates 의 category 부스트가 동작.
_INTENT_CATEGORIES = [
    "고깃집", "곱창집", "갈비집", "족발보쌈", "순댓국", "국밥집", "찌개전골", "샤브샤브", "닭갈비찜닭",
    "치킨집", "횟집", "일식", "중식", "양식", "분식", "국수칼국수", "해물", "아시안", "카페", "술집", "한식",
]

# response_schema: action enum/타입/필수키를 디코딩 단계에서 강제. _coerce 는 유효 id 매칭 등 이중 안전망으로 유지.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": VALID_ACTIONS},
        "target_facility_id": {"type": "string", "nullable": True},
        "match_ids": {"type": "array", "items": {"type": "string"}},
        "search_query": {"type": "string"},
        "intent_category": {"type": "string", "nullable": True},
        "spoken": {"type": "string"},
    },
    "required": ["action", "spoken"],
}

# few-shot: filter↔select↔details 경계와 search_query 확장을 모델에 각인(형식 참고용 — id 는 실제 목록 것으로 대체).
_FEW_SHOT = (
    "\n예시(형식 참고용, 후보 id 는 실제 목록의 것으로 대체):\n"
    '발화 "두 번째 거" → {"action":"select","target_facility_id":"<2번째 후보 id>","match_ids":[],"search_query":"","spoken":"네, 그곳으로 안내할게요."}\n'
    '발화 "양식 먹고싶어" → {"action":"filter","target_facility_id":null,"match_ids":[],"search_query":"파스타 스테이크 피자 양식","spoken":"양식으로 찾아볼게요."}\n'
    '발화 "거기 메뉴 뭐 있어?" → {"action":"details","target_facility_id":null,"match_ids":[],"search_query":"","spoken":"<해당 시설의 실제 대표메뉴/혼잡/도보를 1~2문장으로>"}\n'
    '발화 "가자" → {"action":"accept","target_facility_id":null,"match_ids":[],"search_query":"","spoken":"네, 길 안내를 시작할게요."}\n'
    '발화 "별로" → {"action":"reject","target_facility_id":null,"match_ids":[],"search_query":"","spoken":"알겠습니다, 다른 곳을 볼게요."}\n'
    '발화 "그만" → {"action":"stop","target_facility_id":null,"match_ids":[],"search_query":"","spoken":"안내를 종료할게요."}'
)

_model = None
_model_init_attempted = False
_gen_config = None       # GenerationConfig (lazy)
_safety_settings = None  # list[SafetySetting] (lazy)


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
        # 의도분류·검색어확장은 '같은 발화→같은 분류'가 바람직 → 결정성. details/filter 출력이 길어
        # MAX_TOKENS 절단→빈 .text 가 되지 않도록 max_output_tokens 헤드룸(512) 확보.
        _gen_config = GenerationConfig(
            temperature=0.0,
            top_p=0.95,
            candidate_count=1,
            max_output_tokens=512,
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
        )
        _safety_settings = [
            SafetySetting(category=c, threshold=HarmBlockThreshold.BLOCK_ONLY_HIGH)
            for c in (
                HarmCategory.HARM_CATEGORY_HARASSMENT,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            )
        ]
        _model = GenerativeModel(settings.GEMINI_MODEL, system_instruction=[_SYSTEM_INSTRUCTION])
        logger.info("voice_intent_model_initialized", model=settings.GEMINI_MODEL)
    except Exception as e:
        # response_schema 등 미지원 SDK 면 여기서 잡혀 _model=None → unknown 폴백(데모 안전).
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
        kind = c.get("category") or cuisine  # 시드된 정밀 분류(곱창집 등) 우선, 없으면 원시 태그
        kind_s = f" | 종류: {kind}" if kind else ""
        menu = c.get("menu")  # 시드된 대표 메뉴(상세/맥락 답변용)
        if menu:
            menu = " ".join(str(menu).split()[:3])  # 음성 답변 간결화: 대표메뉴는 3개까지만 노출
        menu_s = f" | 대표메뉴: {menu}" if menu else ""
        # 부가정보(시드 enrich): 주소·전기차충전·실내·주차유형·공영·평균가격 — Gemini 가 '전기차 충전돼?/실내야?/주소?' 답변에 사용.
        meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
        info = []
        if c.get("address"):
            info.append(f"주소 {c.get('address')}")
        if meta.get("ev_charger") is True:
            info.append("전기차충전 가능")
        elif meta.get("ev_charger") is False:
            info.append("전기차충전 없음")
        if meta.get("indoor") is True:
            info.append("실내주차")
        if meta.get("parking_type"):
            info.append(f"{meta['parking_type']}주차")
        if meta.get("is_public"):
            info.append("공영주차장")
        if meta.get("average_price"):
            info.append(f"평균 {meta['average_price']}원")
        info_s = (" | " + ", ".join(info)) if info else ""
        lines.append(f"- id={c.get('id')} | {c.get('name')}{kind_s}{menu_s} | {cong_s} | {walk_s}{info_s}")
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
        '"intent_category":"<filter일 때 아래 분류 중 정확히 하나, 아니면 빈 문자열>",'
        '"spoken":"<사용자에게 말할 한국어 1문장(없는 수치 지어내지 말 것)>"}\n'
        "intent_category 후보(filter일 때만, 발화 의도에 맞는 하나를 '정확히' 그대로): "
        "고깃집/곱창집/갈비집/족발보쌈/순댓국/국밥집/찌개전골/샤브샤브/닭갈비찜닭/치킨집/횟집/일식/중식/양식/분식/국수칼국수/해물/아시안/카페/술집/한식. "
        "예: '국밥'→국밥집, '부대찌개'→찌개전골, '고기'→고깃집, '피자'→양식, '곱창'→곱창집, '짜장면'→중식. 모르면 빈 문자열.\n"
        "분류 규칙: 수락/가자/길안내 의사=accept. 다른 거/넘기기=next. 별로/싫어=reject. "
        "자세히/정보/메뉴/혼잡/얼마나 걸려 같은 질문=details. 그만/취소/중지=stop. "
        "details 일 때는 spoken 에 빈말('알려드릴게요') 대신 해당 시설의 '실제 데이터'를 담아 1~2문장으로 "
        "구체적으로 답하세요 — 위 후보 목록의 종류·대표메뉴·혼잡도·도보시간·주소·전기차충전·실내·공영·평균가격을 활용(대표메뉴는 대표적인 3개까지만 언급, 길게 나열 금지). 어느 시설인지 모호하면 "
        f"현재 추천('{current_name or '없음'}')을 기준으로 하세요. 데이터에 없는 값(영업시간·평점 등 목록에 없는 항목)은 지어내지 말고 "
        "모른다고 솔직히 말하세요. "
        "특정 한 곳을 콕 집으면(예: '두 번째 거', '저 식당') select 로 target_facility_id 를 채우세요. "
        "메뉴·종류·분위기 등 선호로 좁히면(예: '짜장면 먹고싶어', '고깃집', '양식', '조용한 곳') filter 로 하세요. "
        "filter 일 때는 search_query 에 사용자 선호를 한국 음식문화 상식으로 '구체적인 대표 메뉴(요리 이름)'로 확장해 넣으세요. "
        "예: '고깃집'→'삼겹살 갈비 목살 소고기 숯불구이 고깃집', '양식'→'파스타 스테이크 피자 양식', "
        "'피자'→'피자 파스타 양식', '분식'→'떡볶이 김밥 라면 분식', '짜장면 먹고싶어'→'짜장면 짬뽕 탕수육 중식', "
        "'곱창'→'곱창 막창 대창 곱창구이', '치킨'→'후라이드치킨 양념치킨 닭강정', '초밥'→'초밥 스시 사시미 회 롤', "
        "'국밥'→'돼지국밥 순대국밥 해장국 국밥', '국수'→'칼국수 잔치국수 멸치국수 국수', '순대'→'순대 순댓국 순대국밥', "
        "'찌개'→'부대찌개 김치찌개 된장찌개 전골', '부대찌개'→'부대찌개 김치찌개 전골'. "
        "요리 이름 위주로 확장하고(재료만 나열 금지), 서로 다른 인접 분류는 섞지 마세요: "
        "고깃집(삼겹살·갈비) / 곱창집 / 순댓국(순대) / 국밥집(돼지국밥·해장국) / 찌개·전골(부대찌개·김치찌개) / "
        "보쌈집 / 치킨(후라이드·양념) / 닭갈비·찜닭 / 초밥·일식 / 해물·생선 / 국수·칼국수 / 중식(짜장·짬뽕) / "
        "양식(피자·파스타) 은 각각 별개입니다. "
        "특히 '국밥'은 순댓국·찌개가 아니라 돼지국밥·해장국 쪽으로, '부대찌개/찌개'는 국밥이 아니라 찌개·전골 쪽으로, "
        "'피자'는 양식 쪽으로 확장하세요. 고깃집·한식 백반집을 '국밥'으로 잘못 확장하지 마세요. "
        "음주 위주의 술집·포차·이자카야는 음식(밥·메뉴) 발화의 대상이 아니니 그쪽으로 매칭하지 마세요. "
        "후보에 없는 메뉴라도 상식으로 확장하면 됩니다. "
        "정확한 매칭은 이 search_query 로 시스템이 의미검색해 정하므로, match_ids 는 비워 두어도 됩니다(보조용). "
        "spoken 에는 사용자 선호를 받아들이는 한국어 1문장을 담으세요."
        f"{_FEW_SHOT}"
    )


def _fallback() -> dict:
    """Gemini 미사용/실패 시 — 하드코딩 키워드 분류는 하지 않는다(의도/필터는 Gemini 전담).
    항상 unknown 을 반환해 프런트가 '다시 말씀해 주세요'로 재질문하게 한다(엉뚱한 동작 방지)."""
    return {"action": "unknown", "target_facility_id": None, "match_ids": [], "search_query": None, "intent_category": None, "spoken": None}


_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_text(resp) -> str:
    """resp.text 는 후보가 안전필터로 차단되거나(SAFETY/RECITATION/MAX_TOKENS) 빈 Part 면 ValueError 를
    던진다. candidates→parts 를 직접 순회해 부분 응답도 안전하게 모으고, 실패 시 .text 를 가드 접근한다."""
    try:
        for cand in (getattr(resp, "candidates", None) or []):
            content = getattr(cand, "content", None)
            parts = getattr(content, "parts", None) or []
            buf = "".join(getattr(p, "text", "") or "" for p in parts)
            if buf.strip():
                return buf.strip()
    except Exception:
        pass
    try:
        return (getattr(resp, "text", "") or "").strip()
    except Exception:
        return ""


def _parse_json(raw: str) -> Optional[dict]:
    """펜스/앞뒤 잡텍스트/부분 JSON 에 견고. dict 가 아니면 None(비-dict 응답에 의한 크래시 방지)."""
    if not raw:
        return None
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s).strip()
    try:
        obj = json.loads(s)
    except Exception:
        m = _JSON_OBJ_RE.search(s)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except Exception:
            return None
    return obj if isinstance(obj, dict) else None


def _generate_sync(model, prompt: str) -> Optional[dict]:
    try:
        kwargs = {
            "generation_config": _gen_config
            if _gen_config is not None
            else {
                "temperature": 0.0,
                "max_output_tokens": 512,
                "response_mime_type": "application/json",
            },
        }
        if _safety_settings:
            kwargs["safety_settings"] = _safety_settings
        resp = model.generate_content(prompt, **kwargs)
        return _parse_json(_extract_text(resp))
    except Exception as e:
        logger.warning("voice_intent_generate_failed", error_type=type(e).__name__, error=str(e))
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
    _demoted_select = action == "select" and not tid
    if _demoted_select:
        action = "next"
    # filter 는 여기서 강등하지 않는다. 어떤 후보가 맞는지는 라우터의 임베딩 의미검색이 정하고,
    # 벡터·Gemini 둘 다 빈값일 때만 라우터가 next 로 강등한다(선택지 폐기 아님, 우선순위만 조정).
    spoken = parsed.get("spoken")
    # details 답변(메뉴·혼잡 등)은 한 문장보다 길 수 있어 200자까지 허용.
    spoken = spoken.strip()[:200] if isinstance(spoken, str) and spoken.strip() else None
    # select→next 강등 시 'select 멘트'(예: 그곳으로 안내할게요)가 잔존해 실제 next 동작과 어긋나는 것을 막는다(프런트 자체 멘트 사용).
    if _demoted_select:
        spoken = None
    # search_query: filter 일 때 임베딩 의미검색에 쓸 확장 검색어(고깃집→삼겹살·갈비…). 그 외엔 None.
    sq = parsed.get("search_query")
    sq = sq.strip()[:200] if isinstance(sq, str) and sq.strip() else None
    # intent_category: 시드 정밀분류 enum 과 정확히 일치할 때만 통과(filter_candidates 의 category 부스트용).
    ic = parsed.get("intent_category")
    ic = ic.strip() if isinstance(ic, str) and ic.strip() in _INTENT_CATEGORIES else None
    if action != "filter":
        sq = None
        ic = None
    return {"action": action, "target_facility_id": tid, "match_ids": match_ids, "search_query": sq, "intent_category": ic, "spoken": spoken}


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

    prompt = _build_prompt(utterance, facility_type_ko, current_name, candidates or [])
    raw = None
    for attempt in range(2):  # 1차 + (빠른 일시실패에 한해) 1회 재시도. 타임아웃은 재시도 안 함(음성 UX 지연 방지).
        try:
            raw = await asyncio.wait_for(
                asyncio.to_thread(_generate_sync, model, prompt),
                timeout=settings.GEMINI_TIMEOUT_SECONDS,
            )
            if raw:
                break
        except asyncio.TimeoutError:
            logger.warning("voice_intent_timeout", attempt=attempt, timeout=settings.GEMINI_TIMEOUT_SECONDS)
            raw = None
            break  # 예산 이미 소진 → 재시도 없이 폴백
        except Exception as e:
            logger.warning("voice_intent_unexpected_error", attempt=attempt, error=str(e))
            raw = None
        if attempt == 0:
            await asyncio.sleep(0.2)

    # 견고 파서가 dict|None 만 돌려주지만, 방어적으로 isinstance 가드(비-dict 면 unknown 폴백).
    if not isinstance(raw, dict):
        if raw is None:
            logger.info("gemini_fallback_used", service="voice_intent")
        return _fallback()

    result = _coerce(raw, valid_ids)
    logger.info("voice_intent_resolved", action=result["action"], has_target=bool(result["target_facility_id"]))
    return result
