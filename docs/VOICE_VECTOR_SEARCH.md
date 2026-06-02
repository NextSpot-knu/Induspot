# 음성 메뉴 의미검색 (Vertex 임베딩 + Firestore 코사인)

음성 비서가 "짜장면 먹고싶어" / "곱창 땡긴다" / "치킨 먹을래" 같은 **메뉴·선호 발화**를 듣고
실제로 맞는 식당으로 추천을 좁히는 기능. **역할 분리(RAG)**: Gemini 는 의도/대화, 임베딩은 검색.

```
발화 ──▶ Gemini(voice_intent_service)  : action 분류 + 한국어 응답(spoken)
       │                                + search_query: 선호를 '구체 메뉴'로 확장(고깃집→삼겹살·갈비·숯불)
       └▶ action=filter 면 ──▶ embedding_service.filter_candidates(search_query, …)
                               search_query 임베딩 ↔ 식당 문서 임베딩 코사인 → match_ids
```

## 한국 외식문화 분류 (정확도의 핵심)
한국 식당은 **고깃집(삼겹살·갈비) ≠ 곱창집 ≠ 순댓국집 ≠ 보쌈집 ≠ 치킨집 ≠ 닭갈비·찜닭**이 각각 다른
목적지다. 그래서 두 군데서 이 분류를 지킨다:
- **문서 쪽(seed)**: `_TAXONOMY`(연구 기반 19분류)가 이름·태그를 **단일 정밀 분류 하나**로 귀착(태그를
  병합하지 않음). 이름신호 우선('큰집막창'→곱창집, '고향순대'→순댓국). 프로필=이름+분류+그 분류 메뉴.
- **쿼리 쪽(Gemini)**: '고깃집'처럼 추상 단어는 임베딩에서 보쌈·순대(다 돼지)와 뭉친다. 그래서 Gemini 가
  `search_query` 로 **요리 이름까지 확장**('고깃집'→'삼겹살 갈비 목살 숯불구이')하고 인접 분류는 안 섞는다
  (치킨↔닭갈비/찜닭, 초밥↔해물 분리). 한국 음식문화 지식은 Gemini 가 담당 = 사용자가 말한 '학습'.

실측(실제 103개 구미 식당): "고깃집 가자"→고기·갈비집만(곱창·순대·보쌈 0), "곱창"→곱창집만, "순대국밥"→
순댓국만, "치킨"→치킨집만, "초밥"→일식만.

## 구성요소
| 파일 | 역할 |
|---|---|
| `apps/api/app/services/embedding_service.py` | Vertex `text-multilingual-embedding-002` 임베딩 + Firestore 벡터 캐시 + 코사인 top-K |
| `apps/api/app/routers/recommendations.py` (`/voice/turn`) | Gemini=의도, 벡터=match_ids. 벡터·Gemini 둘 다 빈손이면 next 로만 강등(폐기 아님) |
| `apps/api/scripts/seed_facility_embeddings.py` | Supabase facilities → `_TAXONOMY`로 단일 정밀분류 → 프로필(이름+분류+**대표메뉴**) → 임베딩 → Firestore `facility_embeddings/{id}` |
| `apps/api/app/services/voice_intent_service.py` | Gemini가 action + `search_query`(선호→구체 메뉴 확장) 생성 |
| `apps/api/app/core/config.py` | `EMBEDDING_ENABLED`, `EMBEDDING_MODEL`, `FIRESTORE_EMBEDDING_COLLECTION`, `VOICE_VECTOR_MARGIN(0.04)`, `VOICE_VECTOR_TOPK(3)` |

## 왜 '대표 메뉴'까지 임베딩하나 (실측 근거)
태그('중식')만으로는 메뉴 발화 매칭이 약하다. 메뉴 어휘를 프로필에 넣으면 또렷해진다:

| 발화 | 태그만 | 이름+종류+**메뉴** |
|---|---|---|
| 짜장면 먹고싶어 | 중식 **4위** (파스타가 1위) ❌ | **중식 1위** 0.72 단독 ✅ |
| 곱창 땡긴다 | — | 막창집 2곳 격리 ✅ |
| 파스타 / 커피 / 치킨 | — | 각 종류 단독 1위 ✅ |

선택 규칙은 **절대 임계값이 아니라 최고점 대비 margin(0.04) 안에서 top-K(3)** — 다국어 임베딩
코사인이 0.6~0.84 로 압축돼 절대 임계값은 변별력이 없기 때문(실측 보정). margin 0.04 = '고깃집' 확장검색이
실제 고깃집만 집고 닭갈비·곱창집을 배제하는 지점.

## 적용 절차 (한 번)
1. **시드** — 식당 문서 벡터를 Firestore 에 채운다. (이 환경은 cloud-mutating 직접 실행 불가 → 사용자가 실행)
   ```powershell
   cd apps/api
   # 시드용 venv 에 firestore 가 없으면 1회 설치(런타임 이미지엔 이미 포함):
   .venv/Scripts/python.exe -m pip install google-cloud-firestore
   .venv/Scripts/python.exe scripts/seed_facility_embeddings.py          # Gemini 가 메뉴 생성
   #   --no-gemini  메뉴를 내장 어휘집으로만 (Gemini 호출 0)
   #   --dry-run    Firestore 쓰기 없이 프로필/임베딩만 미리보기
   #   --limit N    앞 N개만
   ```
   - 인증: ADC(Vertex/Firestore) + Supabase 키(.env 또는 Secret Manager 자동 로드)
   - ⚠️ **함정**: 같은 PowerShell 창에서 `deploy.ps1` 을 먼저 돌렸다면 `GOOGLE_APPLICATION_CREDENTIALS`
     가 firebase-adminsdk SA 키로 남아 있고, 그 SA 는 Vertex 권한이 없어 임베딩/Gemini 가 `403
     aiplatform.endpoints.predict denied` 로 죽는다. 시드 전에 풀거나(새 창에서 실행):
     `Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue`
     → gcloud ADC(Owner, Vertex 권한 보유)로 인증된다. `--no-gemini` 를 쓰면 Gemini 호출 없이
     택소노미 기본 메뉴로 임베딩만 한다(분류 정확도 동일, 임베딩 권한은 여전히 필요).
   - id 는 **Supabase facilities.id** 로 저장 → 런타임 후보 id 와 정확히 일치
2. **배포** — `EMBEDDING_ENABLED=true` 가 deploy.ps1 에 포함됨.
   ```powershell
   ./deploy.ps1            # 백엔드 재배포(+프런트). 새 리비전이 facility_embeddings 를 메모리 캐시로 로드
   ```
3. (검증) `POST /api/v1/voice/turn` 에 `utterance:"짜장면 먹고싶어"` + candidates(`cuisine` 포함) →
   `action=filter`, `match_ids`=중식 식당.

## 폴백·안전성
- `EMBEDDING_ENABLED=false` 또는 Vertex/임베딩 실패 → 벡터는 빈 리스트 → 라우터가 Gemini match_ids 로 폴백.
- 시드 안 된 후보(더미 시설 등) → 런타임이 즉석 임베딩(이름+종류)으로 보강(빈손 방지).
- 권한: Gemini 와 동일한 Vertex AI API + 기존 Firestore 접근만 사용 → **신규 IAM 불필요**.

## 전체 지도 확장 경로 (Vector Search 승급)
지금은 100여 개라 brute-force 코사인이 충분하고 빠르다(추가 인프라 0원). 수천~수만 POI 로 가면:
1. 같은 `embedding_service.profile_text` + 임베딩으로 벡터 생성(파이프라인 불변)
2. Firestore 저장 대신/병행으로 **Vertex AI Vector Search** 인덱스에 업서트
3. `embedding_service.filter_candidates` 의 코사인 루프만 ANN 질의로 교체
→ 임베딩·프로필·시드 로직은 그대로 재사용. 인덱스/엔드포인트는 상시 비용이라 규모가 커질 때 켠다.
