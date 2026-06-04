"""식당 문서 임베딩 시드 (일회성·멱등): Supabase facilities → Vertex 임베딩 → Firestore.

음성 비서의 '메뉴/선호 의미검색'(embedding_service.filter_candidates)이 읽는 문서 벡터를 채운다.
각 시설의 프로필을 **이름 + 종류(cuisine_tags) + 대표 메뉴**로 구성해 Vertex 다국어 임베딩으로
벡터화하고, Firestore(facility_embeddings/{facility_id})에 저장한다. 런타임은 이 컬렉션을
프로세스 메모리에 1회 로드해 캐시하므로, 시드 후 재배포(또는 인스턴스 교체) 시 반영된다.

왜 '대표 메뉴'까지 넣나(핵심):
  카카오 분류 태그('중식')만으로는 "짜장면 먹고싶어" 같은 메뉴 발화의 임베딩 매칭이 약하다(실측:
  짜장면→중식 4위). 프로필에 메뉴 어휘를 넣으면 또렷해진다(짜장면→중식 1위). 메뉴 어휘는
  기본적으로 **Gemini 가 분류를 보고 생성**하고(= '식당 리스트를 보고 학습 데이터 생성'),
  Gemini 미사용/실패 시 작은 보강 어휘집(_LEXICON)으로 폴백한다. 이 어휘는 '임베딩 텍스트 보강'
  용도이며 의도 분류를 하드코딩하는 것이 아니다(의도/대화는 Gemini 전담, 본 스크립트는 오프라인 데이터 준비).

ID 정합성: 런타임 후보 id 는 Supabase facilities.id(UUID)이므로 **반드시 Supabase 에서 읽어** 같은
id 로 저장한다(CSV 의 id 는 'null' 이라 매칭 불가). 시드 안 된 후보는 런타임이 즉석 임베딩으로 보강한다.

인증: ADC(Vertex/Firestore) + Supabase 키(Secret Manager 또는 .env). 이 환경은 cloud-mutating 을 직접
실행하지 않으므로 **사용자가 직접 실행**한다.

실행(apps/api 디렉터리에서):
  .venv/Scripts/python.exe scripts/seed_facility_embeddings.py
  옵션: --limit N(앞 N개만) --no-gemini(메뉴를 어휘집으로만) --dry-run(쓰기 없이 미리보기)

확장 경로: 전체 지도(수천~수만)로 가면 동일 임베딩을 Vertex AI Vector Search 인덱스에 업서트하면 된다
  (런타임의 brute-force 코사인만 ANN 질의로 교체; 본 시드의 프로필/임베딩 로직은 그대로 재사용).
"""
import argparse
import json
import os
import sys
import time

# apps/api 를 import 경로에 추가(스크립트를 apps/api 에서 실행하지 않아도 동작).
_API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

import requests  # noqa: E402

# app.core.config 임포트 시 load_gcp_secrets()가 Secret Manager 에서 SUPABASE_* 등을 채운다.
from app.core.config import settings  # noqa: E402
from app.services.embedding_service import profile_text  # noqa: E402

# ── 한국 외식 분류 택소노미 (연구 기반). 각 항목: (분류명, 이름신호, 카카오태그신호, 대표메뉴)
# 한국 식당은 '고깃집(삼겹살·갈비)·곱창집·순댓국집·보쌈집·치킨집'이 서로 다른 목적지다. 그래서 태그를
# 합치지 않고 **가장 구체적인 분류 하나**로 귀착시킨다(우선순위 = 리스트 순서, 구체적인 것 먼저).
# 이름신호를 태그신호보다 먼저 본다 — 한국 상호는 보통 전문 메뉴를 이름에 박는다(예: '큰집막창'→곱창집).
_TAXONOMY = [
    # (분류, 이름신호, 태그신호, 대표메뉴)
    ("카페",     ["카페", "커피", "스타벅스", "투썸", "이디야", "메가커피", "베이커리", "제과", "디저트"],
                 ["카페", "디저트"],               "커피 아메리카노 라떼 디저트 케이크 음료"),
    ("치킨집",   ["치킨", "통닭", "닭강정", "BBQ", "BHC", "교촌"],
                 ["치킨"],                          "후라이드치킨 양념치킨 닭강정 치킨"),
    ("곱창집",   ["곱창", "막창", "대창", "양곱창", "양깃머리"],
                 ["곱창,막창"],                     "곱창 막창 대창 양깃머리 곱창전골 막창구이"),
    ("족발보쌈", ["족발", "보쌈"],
                 ["족발,보쌈"],                     "족발 보쌈 수육 막국수"),
    ("순댓국",   ["순댓국", "순대국"],
                 ["순대"],                          "순대 순댓국 순대국밥 머릿고기 수육 순대볶음"),
    ("닭갈비찜닭", ["닭갈비", "찜닭", "닭볶음", "백숙", "삼계탕", "닭한마리"],
                 ["닭요리"],                        "닭갈비 찜닭 닭볶음탕 백숙 삼계탕"),
    ("갈비집",   ["왕갈비", "생갈비", "갈비", "갈빗"],
                 ["갈비"],                          "갈비 돼지갈비 소갈비 양념갈비 숯불갈비"),
    ("횟집",     ["횟집", "회집", "물회", "사시미", "수산"],
                 ["회"],                            "회 물회 사시미 모듬회 매운탕"),
    ("일식",     ["스시", "초밥", "라멘", "돈까스", "우동", "이자카야", "오마카세", "스시야", "소바"],
                 ["일식", "일본식주점", "돈까스,우동"], "초밥 사시미 라멘 돈까스 우동 회"),
    ("중식",     ["반점", "각", "짜장", "차이나", "홍콩", "중화", "루"],
                 ["중식", "중국요리"],              "짜장면 짬뽕 탕수육 볶음밥 군만두"),
    ("양식",     ["파스타", "피자", "스테이크", "키친", "리스토", "이탈리", "레스토랑", "스파게티", "버거"],
                 ["양식", "피자"],                  "파스타 스테이크 피자 리조또 샐러드"),
    ("분식",     ["분식", "김밥", "떡볶이", "토스트", "라볶이"],
                 ["분식", "간식"],                  "떡볶이 김밥 라면 순대 튀김 우동"),
    ("국수칼국수", ["칼국수", "국수", "냉면", "수제비", "막국수"],
                 ["국수", "칼국수"],                "칼국수 잔치국수 냉면 비빔국수 수제비"),
    ("해물",     ["해물", "조개", "생선", "어시장", "아구", "꽃게", "대게"],
                 ["해물,생선"],                     "생선구이 조개구이 해물탕 아구찜 매운탕"),
    ("고깃집",   ["삼겹", "오겹", "고기", "구이", "한우", "숯불", "정육", "축산", "한돈", "우대"],
                 ["육류,고기"],                     "삼겹살 목살 항정살 갈비 소고기 돼지고기 숯불구이"),
    ("국밥집",   ["국밥", "돼지국밥", "순대국밥", "해장", "기사식당"],
                 ["국밥"],                          "돼지국밥 순대국밥 해장국 국밥 수육"),
    ("찌개전골", ["부대찌개", "김치찌개", "된장찌개", "찌개", "전골"],
                 ["찌개,전골"],                     "부대찌개 김치찌개 된장찌개 순두부찌개 전골"),
    ("샤브샤브", ["샤브"],
                 ["샤브샤브"],                      "샤브샤브 소고기 채소 칼국수 죽"),
    ("술집",     ["호프", "주점", "포차", "술집", "선술집", "오뎅바"],
                 ["술집", "호프"],                  "안주 소주 맥주 골뱅이 노가리 오뎅"),
    ("아시안",   ["쌀국수", "베트남", "태국", "분짜", "팟타이", "포"],
                 ["베트남음식", "동남아음식", "아시아음식"], "쌀국수 분짜 팟타이 카레 월남쌈"),
    ("한식",     ["한정식", "백반", "가정식", "밥상", "집밥"],
                 ["한식", "한정식"],                "백반 한정식 비빔밥 제육볶음 김치찌개 된장찌개"),
]

_TYPE_KO = {"cafeteria": "식당", "parking": "주차장", "meeting_room": "회의실",
            "loading_dock": "하역장", "rest_area": "휴게실"}

# 음주 중심 업장 신호(태그/타입). 음식 메뉴를 주지 않아 '고기/국밥/피자' 같은 음식 검색에서 자연히 밀린다.
# (꾸버찌·이자카야진 등 bar 가 음식 후보로 섞여 추천을 오염시키는 문제 방지 — 삭제 대신 분류로 강등.)
_BAR_TAGS = {"술집", "호프", "호프,요리주점", "오뎅바", "실내포장마차", "일본식주점", "포차", "선술집"}


def _resolve_category(name, tags, ftype):
    """이름·태그를 한국 외식 택소노미의 **단일 분류**로 귀착. (분류명, 대표메뉴 or None).

    **태그 우선**(CSV cuisine_tags 는 구체적·고신뢰): 구체 태그(육류,고기 / 국밥 / 피자 …)를 먼저 보고,
    구체 태그가 없을 때만(예: '한식'만 있을 때) 상호 이름신호로 보강한다. 이전엔 이름신호를 먼저 봐
    '삼겹당순대당'(태그=육류,고기)이 이름 '순대' 때문에 순댓국으로 오분류되어 '국밥' 검색을 오염시켰다.
    음식 아닌 시설(주차장 등)·술집은 음식 메뉴 없이 분류만 둔다.
    """
    nm = name or ""
    tagset = set(tags or [])
    # 0) 음주 업장은 음식 메뉴 없이 '술집'으로 강등(음식 검색에서 밀림). bar 타입 또는 음주 태그.
    if (ftype or "").lower() == "bar" or (tagset & _BAR_TAGS):
        return "술집", "안주 소주 맥주 골뱅이 노가리 오뎅"
    if tagset:
        # 1) 태그신호 우선(구체적 분류부터). '한식'은 폴백으로 미뤄 구체 분류가 항상 이긴다.
        for label, _name_sigs, tag_sigs, menu in _TAXONOMY:
            if label == "한식":
                continue
            if any(t in tagset for t in tag_sigs):
                return label, menu
        # 2) 구체 태그가 없으면(예: '한식'만) 상호 이름신호로 보강(예: '큰집막창'→곱창집).
        for label, name_sigs, _tag_sigs, menu in _TAXONOMY:
            if any(sig in nm for sig in name_sigs):
                return label, menu
        # 3) '한식' 태그 폴백
        for label, _name_sigs, tag_sigs, menu in _TAXONOMY:
            if label == "한식" and any(t in tagset for t in tag_sigs):
                return label, menu
        return "한식", "백반 한정식 비빔밥 제육볶음 김치찌개"   # 4) 분류불명 음식점 기본
    # 태그 없음: 이름신호로만 분류(태그 없는 식당 대비)
    for label, name_sigs, _tag_sigs, menu in _TAXONOMY:
        if any(sig in nm for sig in name_sigs):
            return label, menu
    return _TYPE_KO.get(ftype, ftype or "시설"), None


def _fetch_facilities(limit=None):
    """Supabase REST 로 facilities(id,name,type,features) 를 읽는다(서비스/anon 키)."""
    base = settings.SUPABASE_URL.rstrip("/")
    key = settings.SUPABASE_KEY
    if not base or not key:
        raise SystemExit("SUPABASE_URL / 키가 없습니다(.env 또는 Secret Manager 확인).")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    url = f"{base}/rest/v1/facilities?select=id,name,type,features&limit={limit or 5000}"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def _features_of(fac):
    """facilities.features 를 dict 로 정규화(문자열 JSON 도 파싱)."""
    feats = fac.get("features")
    if isinstance(feats, str):
        try:
            feats = json.loads(feats)
        except Exception:
            feats = {}
    return feats or {}


def _tags_of(fac):
    feats = _features_of(fac)
    tags = feats.get("cuisine_tags") or []
    if isinstance(tags, str):
        tags = [tags]
    return [str(t) for t in tags if t]


def _gemini_menu_fn(enabled):
    """분류명 → 대표 메뉴 1줄. Gemini 사용(가능 시) + 분류별 캐시(분류당 1회 호출). 실패 시 None.

    분류(고깃집/곱창집/중식…)는 _resolve_category 가 이미 정밀하게 정하므로, Gemini 는 그 분류의
    대표 메뉴 어휘만 넓혀준다(이름 앵커는 프로필 앞단이 담당). 분류 종류가 ~20개라 호출도 ~20회.
    """
    if not enabled:
        return lambda label: None
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel
        vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
        model = GenerativeModel(settings.GEMINI_MODEL)
    except Exception as e:
        print(f"[warn] Gemini 초기화 실패 → 택소노미 폴백: {e}")
        return lambda label: None

    cache = {}

    def gen(label):
        if not label:
            return None
        if label in cache:
            return cache[label]
        prompt = (
            f"한국의 '{label}' 음식점에서 파는 대표 메뉴를 한국어 단어로 6~10개만, 공백으로 구분해 "
            "한 줄로 출력하세요. 그 분류에 실제로 어울리는 메뉴만(다른 분류 메뉴 섞지 말 것). "
            "메뉴 단어 외 다른 말·기호·번호는 금지."
        )
        try:
            resp = model.generate_content(prompt)
            txt = (resp.text or "").strip().splitlines()[0].strip()
            txt = txt.replace(",", " ").replace("·", " ")
            txt = " ".join(txt.split())[:120]
            cache[label] = txt or None
        except Exception as e:
            print(f"[warn] Gemini 메뉴 생성 실패('{label}'): {e}")
            cache[label] = None
        return cache[label]

    return gen


def _embed_documents(texts, model):
    from vertexai.language_models import TextEmbeddingInput
    out = []
    B = 64  # get_embeddings 배치 상한 여유
    for i in range(0, len(texts), B):
        chunk = texts[i:i + B]
        inputs = [TextEmbeddingInput(t, "RETRIEVAL_DOCUMENT") for t in chunk]
        out.extend(e.values for e in model.get_embeddings(inputs))
        time.sleep(0.05)
    return out


def main():
    ap = argparse.ArgumentParser(description="Seed facility embeddings into Firestore.")
    ap.add_argument("--limit", type=int, default=None, help="앞 N개 시설만 처리")
    ap.add_argument("--no-gemini", action="store_true", help="메뉴를 Gemini 없이 택소노미 기본값으로만 생성")
    ap.add_argument("--dry-run", action="store_true", help="Firestore 쓰기 없이 미리보기")
    args = ap.parse_args()

    print(f"[1/4] Supabase facilities 로드... (project={settings.GCP_PROJECT_ID})")
    facilities = _fetch_facilities(args.limit)
    print(f"      {len(facilities)}개 시설")

    menu_fn = _gemini_menu_fn(enabled=not args.no_gemini)

    print("[2/4] 프로필 구성(이름 + 단일 정밀분류 + 대표메뉴)...")
    rows = []  # (id, name, type, category, menu, profile)
    for fac in facilities:
        fid = fac.get("id")
        name = fac.get("name") or ""
        ftype = fac.get("type") or ""
        if not fid:
            continue
        tags = _tags_of(fac)
        # 이름·태그 → 한국 외식 택소노미의 단일 정밀 분류(고깃집≠곱창집≠순댓국).
        category, default_menu = _resolve_category(name, tags, ftype)
        # 대표메뉴 우선순위: ① features.signature_menu(식당별 실측·웹확인, scripts/enrich_facilities 가 채움; 권위)
        #                  → ② Gemini 분류 메뉴 → ③ 택소노미 기본값.
        # signature_menu 는 '그 가게 고유'라 카테고리 공통 나열(피자헛=제이미버거가 똑같던 버그)보다 정확하다.
        sig = str(_features_of(fac).get("signature_menu") or "").strip()
        if sig and default_menu is not None:
            menu = sig
        else:
            menu = (menu_fn(category) or default_menu) if default_menu is not None else None
        # 프로필: 이름을 앞에 둬 이름 매칭을 살리고, 분류·메뉴로 의미를 좁힌다.
        profile = profile_text(name, category, menu)
        rows.append((fid, name, ftype, category, menu, profile))

    # 미리보기 샘플
    print("      예시:")
    for r in rows[:6]:
        print(f"        - {r[1]} -> {r[5]}")

    print(f"[3/4] Vertex 임베딩({settings.EMBEDDING_MODEL})... {len(rows)}건")
    import vertexai
    from vertexai.language_models import TextEmbeddingModel
    vertexai.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
    emb_model = TextEmbeddingModel.from_pretrained(settings.EMBEDDING_MODEL)
    vectors = _embed_documents([r[5] for r in rows], emb_model)
    dim = len(vectors[0]) if vectors else 0
    print(f"      {len(vectors)}개 벡터({dim}차원)")

    if args.dry_run:
        print("[4/4] --dry-run: Firestore 쓰기 생략. 완료.")
        return

    print(f"[4/4] Firestore '{settings.FIRESTORE_EMBEDDING_COLLECTION}' 업서트...")
    try:
        from google.cloud import firestore
    except ImportError:
        raise SystemExit(
            "google-cloud-firestore 가 이 환경에 없습니다. 시드를 실행할 venv 에 설치하세요:\n"
            "  .venv/Scripts/python.exe -m pip install google-cloud-firestore\n"
            "(--dry-run 은 Firestore 없이 프로필/임베딩만 미리볼 수 있습니다.)"
        )
    db = firestore.Client(project=settings.GCP_PROJECT_ID)
    col = db.collection(settings.FIRESTORE_EMBEDDING_COLLECTION)
    # 문서별 개별 set(). 벡터(768-요소 배열)는 Firestore 가 원소마다 색인을 만들어, 여러 건을 한 배치로
    # 묶으면 색인 항목이 폭증해 'Transaction too big' 이 난다(147*768≈11만). 개별 쓰기로 회피(일회성 시드).
    n = 0
    for (fid, name, ftype, category, menu, profile), vec in zip(rows, vectors):
        col.document(str(fid)).set({
            "vector": [float(x) for x in vec],
            "name": name,
            "type": ftype,
            "category": category,   # 단일 정밀 분류(고깃집/곱창집/순댓국…)
            "menu": menu,
            "profile": profile,
            "model": settings.EMBEDDING_MODEL,
            "dim": dim,
        })
        n += 1
        if n % 25 == 0:
            print(f"      {n}/{len(rows)} 저장...")
    print(f"      완료: {n}건 저장(collection={settings.FIRESTORE_EMBEDDING_COLLECTION}).")
    print("재배포(또는 인스턴스 교체) 후 음성 필터가 메뉴 의미검색을 사용합니다. EMBEDDING_ENABLED=true 필요.")


if __name__ == "__main__":
    main()
