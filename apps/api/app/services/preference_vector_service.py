# pyrefly: ignore [missing-import]
import asyncio
import math
import structlog
from app.core.config import settings

logger = structlog.get_logger()

# Firestore 클라이언트는 lazy/폴백 원칙에 따라 import 자체가 앱을 죽이지 않게 보호한다.
try:
    # pyrefly: ignore [missing-import]
    from google.cloud import firestore
except Exception:  # 라이브러리 미설치 등
    firestore = None


class PreferenceVectorStore:
    """사용자 8차원 선호 벡터 저장소 — GCP Firestore 백엔드.

    설계 노트: 이 저장소는 ANN(최근접 이웃) 검색이 아니라 **user_id 로 벡터를 저장/조회(KV)**
    하는 용도다(코사인 유사도는 tttv/preference.py 가 CATEGORY_VECTORS 와 로컬 계산). 따라서
    Vertex AI Vector Search 가 아니라 Firestore 문서 저장이 정확하고 안정적인 GCP 대체재다.
    (Vector Search 는 인덱스 콜드스타트·streaming upsert 의 eventual consistency 때문에
     "피드백 직후 같은 벡터를 즉시 읽어야 하는" 이 패턴에 부적합하다.)

    폴백 우선: Firestore 미가용/실패 시 get→None, upsert→no-op (벡터 저장소 미설정 시 무해한 동작).
    외부 인터페이스(_normalize_vector / get_user_vector / upsert_user_vector /
    adjust_user_vector_on_feedback)는 시그니처 호환을 위해 그대로 유지한다(내부 백엔드만 Firestore).
    """

    def __init__(self):
        self.client = None
        if firestore is not None and settings.GCP_PROJECT_ID:
            try:
                db = settings.FIRESTORE_DATABASE
                if db and db != "(default)":
                    self.client = firestore.Client(project=settings.GCP_PROJECT_ID, database=db)
                else:
                    self.client = firestore.Client(project=settings.GCP_PROJECT_ID)
            except Exception as e:
                logger.warning("firestore_init_failed", error=str(e))

    @property
    def available(self) -> bool:
        """저장소 사용 가능 여부(벡터 백엔드 클라이언트 초기화 성공 여부)."""
        return self.client is not None

    def _doc(self, user_id: str):
        return self.client.collection(settings.FIRESTORE_COLLECTION).document(str(user_id))

    def _normalize_vector(self, vector: list[float]) -> list[float]:
        """L2 정규화를 통해 벡터 크기를 1로 조절합니다."""
        sq_sum = sum(x ** 2 for x in vector)
        if sq_sum == 0:
            # 8차원 기본 제로 벡터 방지
            return [1.0 / math.sqrt(8)] * 8
        norm = math.sqrt(sq_sum)
        return [x / norm for x in vector]

    async def get_user_vector(self, user_id: str) -> list[float] | None:
        """Firestore에서 사용자 선호도 벡터를 비동기적으로 조회합니다."""
        if not self.client:
            return None
        try:
            snap = await asyncio.to_thread(self._doc(user_id).get)
            if snap.exists:
                data = snap.to_dict() or {}
                vec = data.get("vector")
                if vec and len(vec) == 8:
                    return [float(x) for x in vec]
                if vec:
                    # 문서는 있으나 차원 불일치(외부 오염/스키마 변경). 상위가 콜드스타트로 조용히 덮어쓰기 전에
                    # 가시화한다(관측성만 추가 — 복구 동작은 그대로 두는 게 안전).
                    logger.warning("firestore_vector_dim_mismatch", user_id=user_id, dim=len(vec))
        except Exception as e:
            logger.warning("firestore_get_user_vector_failed", user_id=user_id, error=str(e))
        return None

    async def upsert_user_vector(self, user_id: str, vector: list[float]):
        """사용자 선호도 벡터를 정규화하여 Firestore에 저장합니다."""
        if not self.client:
            return
        normalized = self._normalize_vector(vector)
        try:
            await asyncio.to_thread(
                self._doc(user_id).set,
                {"vector": normalized, "type": "user"},
            )
        except Exception as e:
            logger.warning("firestore_upsert_user_vector_failed", user_id=user_id, error=str(e))

    async def adjust_user_vector_on_feedback(self, user_id: str, facility_vector: list[float], action: str):
        """사용자 피드백에 따라 선호도 벡터를 점진적으로 업데이트합니다.
        - 수락(accepted): 시설 벡터 방향으로 10% 이동
        - 거절(rejected/ignored): 반대 방향으로 5% 이동
        """
        current_vector = await self.get_user_vector(user_id)
        if not current_vector:
            current_vector = [0.0] * 8

        current_vector = self._normalize_vector(current_vector)
        facility_vector = self._normalize_vector(facility_vector)

        if action == "accepted":
            # v_new = v_old + 0.1 * (v_facility - v_old)
            new_vector = [
                v_old + 0.1 * (v_fac - v_old)
                for v_old, v_fac in zip(current_vector, facility_vector)
            ]
        else:  # rejected, ignored
            # v_new = v_old - 0.05 * (v_facility - v_old)
            new_vector = [
                v_old - 0.05 * (v_fac - v_old)
                for v_old, v_fac in zip(current_vector, facility_vector)
            ]

        await self.upsert_user_vector(user_id, new_vector)


# 싱글톤 인스턴스 (GCP 네이티브 Firestore 백엔드; 시그니처 호환 유지)
preference_vector_service = PreferenceVectorStore()
