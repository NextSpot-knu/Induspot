# pyrefly: ignore [missing-import]
import asyncio
import math
from pinecone import Pinecone
from app.core.config import settings

class PineconeService:
    def __init__(self):
        self.pc = None
        self.index = None
        if settings.PINECONE_API_KEY:
            try:
                self.pc = Pinecone(api_key=settings.PINECONE_API_KEY)
                self.index = self.pc.Index(settings.PINECONE_INDEX_NAME)
            except Exception as e:
                print(f"[PineconeService] Failed to initialize index: {str(e)}")

    def _normalize_vector(self, vector: list[float]) -> list[float]:
        """
        L2 정규화를 통해 벡터 크기를 1로 조절합니다.
        """
        sq_sum = sum(x ** 2 for x in vector)
        if sq_sum == 0:
            # 8차원 기본 제로 벡터 방지
            return [1.0 / math.sqrt(8)] * 8
        norm = math.sqrt(sq_sum)
        return [x / norm for x in vector]

    async def get_user_vector(self, user_id: str) -> list[float] | None:
        """
        Pinecone에서 사용자 선호도 벡터를 비동기적으로 조회합니다.
        """
        if not self.index:
            return None
        
        try:
            # 동기 메소드이므로 asyncio.to_thread로 실행
            result = await asyncio.to_thread(
                self.index.fetch,
                ids=[f"user_{user_id}"]
            )
            vectors = result.get("vectors", {})
            if f"user_{user_id}" in vectors:
                return vectors[f"user_{user_id}"]["values"]
        except Exception as e:
            print(f"[PineconeService] Fetch user vector failed: {str(e)}")
        
        return None

    async def upsert_user_vector(self, user_id: str, vector: list[float]):
        """
        사용자 선호도 벡터를 정규화하여 Pinecone에 업로드합니다.
        """
        if not self.index:
            return
        
        normalized = self._normalize_vector(vector)
        try:
            await asyncio.to_thread(
                self.index.upsert,
                vectors=[(f"user_{user_id}", normalized, {"type": "user"})]
            )
        except Exception as e:
            print(f"[PineconeService] Upsert user vector failed: {str(e)}")

    async def query_similar_facilities(self, user_vector: list[float], top_k: int = 5) -> list[dict]:
        """
        사용자 벡터와 유사도가 높은 시설들을 검색합니다.
        """
        if not self.index:
            return []
        
        normalized = self._normalize_vector(user_vector)
        try:
            result = await asyncio.to_thread(
                self.index.query,
                vector=normalized,
                top_k=top_k,
                include_metadata=True,
                filter={"type": {"$eq": "facility"}}
            )
            return result.get("matches", [])
        except Exception as e:
            print(f"[PineconeService] Query similar facilities failed: {str(e)}")
            return []

    async def adjust_user_vector_on_feedback(self, user_id: str, facility_vector: list[float], action: str):
        """
        사용자 피드백에 따라 사용자 선호도 벡터를 점진적으로 업데이트합니다.
        - 수락(accepted): 시설 벡터 방향으로 10% 이동
        - 거절(rejected/ignored): 반대 방향으로 5% 이동
        """
        # 기존 사용자 벡터 획득 (없으면 8차원 디폴트 기준벡터)
        current_vector = await self.get_user_vector(user_id)
        if not current_vector:
            current_vector = [0.0] * 8
        
        current_vector = self._normalize_vector(current_vector)
        facility_vector = self._normalize_vector(facility_vector)

        # 피드백 반영 연산
        if action == "accepted":
            # v_new = v_old + 0.1 * (v_facility - v_old)
            new_vector = [
                v_old + 0.1 * (v_fac - v_old)
                for v_old, v_fac in zip(current_vector, facility_vector)
            ]
        else: # rejected, ignored
            # v_new = v_old - 0.05 * (v_facility - v_old)
            new_vector = [
                v_old - 0.05 * (v_fac - v_old)
                for v_old, v_fac in zip(current_vector, facility_vector)
            ]

        # 정규화하여 업서트
        await self.upsert_user_vector(user_id, new_vector)

# 싱글톤 인스턴스
pinecone_service = PineconeService()
