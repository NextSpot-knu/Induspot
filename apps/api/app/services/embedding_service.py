"""의미 검색 임베딩 서비스 — Vertex AI 텍스트 임베딩 + Firestore 벡터 캐시.

역할 분리(RAG): Gemini 는 의도/대화를 맡고, **임베딩은 메뉴·선호 → 식당 의미 매칭(retrieval)** 을 맡는다.
사용자가 "짜장면 먹고싶어" / "곱창 땡긴다" 처럼 메뉴를 말하면, 각 후보 식당의 문서 벡터와
발화 벡터의 코사인 유사도로 가장 맞는 후보들을 좁힌다.

데이터 흐름:
  - 문서(식당) 벡터: seed 스크립트(scripts/seed_facility_embeddings.py)가 식당 프로필
    (이름 + 종류 + **대표 메뉴**)을 Vertex 임베딩으로 벡터화해 Firestore(facility_embeddings/{id})에 저장.
    메뉴 어휘가 있어야 "짜장면"→중식 같은 매칭이 또렷해진다(실측 보정 완료).
  - 런타임: Firestore 의 문서 벡터를 프로세스 메모리에 1회 로드해 캐시. 캐시에 없는 후보
    (예: 시드 안 된 더미 시설)는 즉석 임베딩(name+종류)으로 보강해 빈손이 되지 않게 한다.

확장 경로: 전체 지도(수천~수만 POI)로 가면 이 동일 임베딩을 Vertex AI Vector Search 인덱스로
그대로 승급하면 된다(여기 brute-force 코사인만 ANN 질의로 교체; 임베딩 파이프라인은 불변).

설계 원칙(프로젝트 공통): 타임아웃 + 폴백. 임베딩 비활성/실패/타임아웃 시 빈 리스트를 돌려
라우터가 Gemini match_ids 로 폴백하게 한다(데모가 멈추지 않음).
"""

import asyncio
import math
from typing import Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger()

_model = None
_model_init_attempted = False
_fs_client = None
_fs_init_attempted = False
# 식당 문서 벡터 캐시: {facility_id: {"vector": [float], "name", "tags", "menu"}}
_doc_cache: Optional[dict] = None


# ────────────────────────────────────────────────────────────────────
# Vertex 임베딩 모델 / Firestore 클라이언트 (지연 초기화 + 폴백)
# ────────────────────────────────────────────────────────────────────
def _get_model():
    global _model, _model_init_attempted
    if _model_init_attempted:
        return _model
    _model_init_attempted = True
    if not settings.EMBEDDING_ENABLED:
        return None
    try:
        import vertexai
        from vertexai.language_models import TextEmbeddingModel

        vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
        _model = TextEmbeddingModel.from_pretrained(settings.EMBEDDING_MODEL)
        logger.info("embedding_model_initialized", model=settings.EMBEDDING_MODEL)
    except Exception as e:
        logger.warning("embedding_model_init_failed", error=str(e))
        _model = None
    return _model


def _get_fs():
    global _fs_client, _fs_init_attempted
    if _fs_init_attempted:
        return _fs_client
    _fs_init_attempted = True
    try:
        from google.cloud import firestore

        db = settings.FIRESTORE_DATABASE
        if db and db != "(default)":
            _fs_client = firestore.Client(project=settings.GCP_PROJECT_ID, database=db)
        else:
            _fs_client = firestore.Client(project=settings.GCP_PROJECT_ID)
    except Exception as e:
        logger.warning("embedding_firestore_init_failed", error=str(e))
        _fs_client = None
    return _fs_client


# ────────────────────────────────────────────────────────────────────
# 프로필 텍스트 / 임베딩 / 코사인 (seed 스크립트와 공유하는 표준 형식)
# ────────────────────────────────────────────────────────────────────
def cuisine_to_str(cuisine) -> str:
    """cuisine_tags(['한식','육류,고기'] 또는 '양식')를 공백 구분 문자열로."""
    if not cuisine:
        return ""
    if isinstance(cuisine, (list, tuple)):
        return " ".join(str(x) for x in cuisine if x)
    return str(cuisine)


def profile_text(name, cuisine, menu: Optional[str] = None, extra: Optional[str] = None) -> str:
    """시설 문서 임베딩에 쓰는 표준 프로필 문장. seed/런타임이 동일 형식을 써야 벡터가 호환된다.

    extra: 부가 어휘(주소/EV충전/실내/공영/채식 등) — '전기차 충전 주차장' 같은 속성 발화의 의미검색을 또렷하게.
    """
    parts = [str(name or "").strip()]
    tags = cuisine_to_str(cuisine)
    if tags:
        parts.append(f"종류: {tags}")
    if menu:
        parts.append(f"대표 메뉴: {menu}")
    if extra:
        parts.append(str(extra).strip())
    return ". ".join(p for p in parts if p)


def build_facility_meta(ftype, features) -> tuple:
    """시설 features → (임베딩 보강 어휘 extra, 저장/프롬프트용 meta dict).

    AI(음성비서·의미검색)가 '전기차 충전돼?/실내야?/공영이야?/주소?/얼마?' 류 질문에 실제 데이터로 답하고,
    속성 발화('전기차 충전 주차장')를 벡터로 또렷이 매칭하도록 시설 부가정보를 표준화한다.
    """
    f = features if isinstance(features, dict) else {}
    meta: dict = {}
    words: list = []
    addr = f.get("address")
    if addr:
        meta["address"] = addr
        words.append(str(addr))
    t = (ftype or "").lower()
    if t == "parking":
        if f.get("has_ev_charger"):
            meta["ev_charger"] = True
            words.append("전기차 충전 가능 EV 충전소")
        elif f.get("has_ev_charger") is False:
            meta["ev_charger"] = False
        if f.get("indoor"):
            meta["indoor"] = True
            words.append("실내 주차 지하주차장")
        elif f.get("indoor") is False:
            meta["indoor"] = False
        if f.get("parking_type"):
            meta["parking_type"] = f.get("parking_type")
            words.append(f"{f.get('parking_type')} 주차장")
        if f.get("is_public"):
            meta["is_public"] = True
            words.append("공영 공용 무료 주차장")
        cap = f.get("max_capacity_vehicles") or f.get("capacity")
        if cap:
            meta["capacity"] = cap
    else:
        if f.get("average_price"):
            meta["average_price"] = f.get("average_price")
        if f.get("has_vegetarian"):
            meta["vegetarian"] = True
            words.append("채식 비건 가능")
        if f.get("phone"):
            meta["phone"] = f.get("phone")
    return (" ".join(words), meta)


def _embed_call(model, texts, task_type):
    from vertexai.language_models import TextEmbeddingInput

    inputs = [TextEmbeddingInput(t, task_type) for t in texts]
    return [e.values for e in model.get_embeddings(inputs)]


async def embed_texts(texts, task_type: str):
    """텍스트 배치를 임베딩(단일 배치 호출). 실패/타임아웃 시 빈 리스트.

    모델 초기화(콜드 스타트)는 **타임아웃 밖**에서 1회 완료시킨다. 타임아웃 안에서 init 하면 첫
    호출이 timeout→detached thread 로 _model 이 빈 채 남아 이후 호출까지 전부 빈손이 되는 race 가 난다.
    """
    texts = [t for t in (texts or []) if t]
    if not texts:
        return []
    model = await asyncio.to_thread(_get_model)
    if model is None:
        return []
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(_embed_call, model, texts, task_type),
            timeout=settings.EMBEDDING_TIMEOUT_SECONDS,
        )
        return res or []
    except asyncio.TimeoutError:
        logger.warning("embedding_timeout", timeout=settings.EMBEDDING_TIMEOUT_SECONDS, n=len(texts))
        return []
    except Exception as e:
        logger.warning("embedding_call_failed", error=str(e))
        return []


def _cosine(a, b) -> float:
    d = na = nb = 0.0
    for x, y in zip(a, b):
        d += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return d / math.sqrt(na * nb)


# ────────────────────────────────────────────────────────────────────
# 문서 벡터 캐시 (Firestore 1회 로드 → 메모리)
# ────────────────────────────────────────────────────────────────────
def _load_cache_sync() -> dict:
    cache: dict = {}
    fs = _get_fs()
    if fs is None:
        return cache
    try:
        for snap in fs.collection(settings.FIRESTORE_EMBEDDING_COLLECTION).stream():
            data = snap.to_dict() or {}
            vec = data.get("vector")
            if vec:
                cache[snap.id] = {
                    "vector": [float(x) for x in vec],
                    "name": data.get("name"),
                    "category": data.get("category"),
                    "menu": data.get("menu"),
                    "address": data.get("address"),
                    "meta": data.get("meta") or {},
                }
    except Exception as e:
        logger.warning("embedding_cache_load_failed", error=str(e))
    return cache


async def _get_cache() -> dict:
    global _doc_cache
    if _doc_cache is None:
        _doc_cache = await asyncio.to_thread(_load_cache_sync)
        logger.info("embedding_cache_loaded", count=len(_doc_cache))
    return _doc_cache


async def _doc_vectors(candidates) -> dict:
    """후보 id → 문서 벡터. 캐시 우선, 없으면 즉석 임베딩(한 번의 배치 호출)으로 보강."""
    cache = await _get_cache()
    out: dict = {}
    missing = []
    for c in candidates:
        cid = c.get("id")
        if cid is None:
            continue
        hit = cache.get(cid)
        if hit and hit.get("vector"):
            out[cid] = hit["vector"]
        else:
            missing.append(c)
    if missing:
        texts = [profile_text(c.get("name"), c.get("cuisine")) for c in missing]
        vecs = await embed_texts(texts, "RETRIEVAL_DOCUMENT")
        if vecs and len(vecs) == len(missing):
            for c, v in zip(missing, vecs):
                out[c["id"]] = v
                # 메모리 캐시만 데움(요청 경로에서 Firestore 쓰기는 하지 않는다).
                cache[c["id"]] = {"vector": v, "name": c.get("name"), "category": None, "menu": None, "address": None, "meta": {}}
    return out


async def enrich_candidates(candidates: list) -> list:
    """후보 dict 에 시드된 **분류(category)·대표메뉴(menu)** 를 채운다(상세/맥락 답변용).

    Gemini 가 "자세히 알려줘"·"메뉴 뭐 있어?" 같은 질문에 실제 데이터로 답하려면 프롬프트에 그 정보가
    있어야 한다. facility_embeddings 캐시(이름·분류·메뉴)를 후보 id 로 조회해 보강한다. 캐시에 없으면
    그대로 두고(빈손 방지), EMBEDDING 비활성/Firestore 불가 시에도 안전하게 no-op.
    """
    if not candidates:
        return candidates
    try:
        cache = await _get_cache()
    except Exception as e:
        logger.warning("enrich_candidates_cache_failed", error=str(e))
        return candidates
    for c in candidates:
        hit = cache.get(c.get("id"))
        if not hit:
            continue
        if not c.get("category") and hit.get("category"):
            c["category"] = hit["category"]
        if not c.get("menu") and hit.get("menu"):
            c["menu"] = hit["menu"]
        if not c.get("address") and hit.get("address"):
            c["address"] = hit["address"]
        if hit.get("meta") and not c.get("meta"):
            c["meta"] = hit["meta"]  # ev_charger/indoor/parking_type/is_public/price 등(프롬프트·답변 근거)
    return candidates


# ────────────────────────────────────────────────────────────────────
# 공개 API: 발화 의미에 맞는 후보 id 선택
# ────────────────────────────────────────────────────────────────────
async def filter_candidates(utterance: str, candidates: list, margin: float = None, top_k: int = None, intent_category: str = None) -> list:
    """발화('짜장면 먹고싶어')에 의미적으로 맞는 후보 id 들을 반환.

    '최고 유사도 대비 margin' 안의 후보를 top_k 개까지 + **보수적 절대 코사인 하한**(무관 꼬리 차단).
    intent_category(Gemini 가 정한 시드 정밀분류, 예 '국밥집')가 주어지면 그 category 후보에 **소프트 부스트**를
    줘 인접분류 leak(국밥↔순댓국↔찌개)을 억제한다 — 배타 게이트가 아니라 가산이라, category 없는(미시드/즉석)
    후보는 배제하지 않아 폴백·빈손방지를 보존한다. 매칭 실패/임베딩 미사용 시 빈 리스트.
    """
    if not settings.EMBEDDING_ENABLED:
        return []
    utterance = (utterance or "").strip()
    if not utterance or not candidates:
        return []

    margin = settings.VOICE_VECTOR_MARGIN if margin is None else margin
    top_k = settings.VOICE_VECTOR_TOPK if top_k is None else top_k
    floor = settings.VOICE_VECTOR_MIN_COSINE
    boost = settings.VOICE_CATEGORY_BOOST

    qvecs = await embed_texts([utterance], "RETRIEVAL_QUERY")
    if not qvecs:
        return []
    qv = qvecs[0]

    dvecs = await _doc_vectors(candidates)
    cache = await _get_cache()  # 시드 정밀분류(category) 조회용
    scored = []
    cat_of: dict = {}
    for c in candidates:
        cid = c.get("id")
        v = dvecs.get(cid)
        if not v:
            continue
        s = _cosine(qv, v)
        cat = (cache.get(cid) or {}).get("category")
        cat_of[cid] = cat
        # 시드 정밀분류가 Gemini 의도분류와 정확히 일치하면 소프트 부스트(국밥집이 인접분류보다 확실히 우선).
        if intent_category and cat and cat == intent_category:
            s += boost
        scored.append((s, cid))
    if not scored:
        return []

    scored.sort(key=lambda x: x[0], reverse=True)

    # 분류 게이트(엉뚱 분류 누설 차단 + 리밋 해제): Gemini 가 정한 정밀분류(intent_category)가 분명하면,
    #   · 그 분류 후보가 풀에 있으면 → 그 분류 후보를 '전부'(코사인 순) 반환(top_k 캡 없음 = 대안 리밋 해제).
    #     ('중식' 발화에 어탕칼국수(국수)·백숙(한식)이 섞이던 누설을 원천 차단. margin/floor 우회.)
    #   · 그 분류 후보가 풀에 없으면 → 빈 리스트(없는데 억지 매칭 금지; 라우터가 next 로 강등).
    # 분류 미상(자유발화)일 때만 코사인 margin/floor + top_k 동작을 쓴다.
    if intent_category and any(cat_of.values()):
        # 분류정보가 하나라도 채워진 경우에만 게이트(시드 분류 신뢰). 그 분류 후보를 코사인 순 '전부' 반환.
        # (Firestore 불가/미시드라 cat 이 전부 None 이면 게이트하지 않고 아래 코사인 폴백으로 진행 → 거짓 빈손 방지.)
        same = [cid for _s, cid in scored if cat_of.get(cid) == intent_category]
        logger.info(
            "embedding_filter_resolved", mode="category_gate",
            n_candidates=len(candidates), n_selected=len(same), intent_category=intent_category,
        )
        return same

    top = scored[0][0]
    # 상대 margin(최고점 근방) + 보수적 절대 하한(무관 후보 차단).
    selected = [cid for s, cid in scored if s >= top - margin and s >= floor][:top_k]
    logger.info(
        "embedding_filter_resolved", mode="vector_margin",
        n_candidates=len(candidates), n_selected=len(selected), top=round(top, 3), floor=floor,
    )
    return selected
