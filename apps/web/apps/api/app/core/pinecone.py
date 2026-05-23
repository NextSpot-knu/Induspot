# pyrefly: ignore [missing-import]
from pinecone import Pinecone
from app.core.config import settings

class PineconeWrapper:
    def __init__(self):
        self.pc = None
        self.index = None
        if settings.PINECONE_API_KEY:
            try:
                # Pinecone v3.x 버전 초기화
                self.pc = Pinecone(api_key=settings.PINECONE_API_KEY)
                # 인덱스 가져오기 (인덱스가 존재한다는 가정 하에 연결)
                self.index = self.pc.Index(settings.PINECONE_INDEX_NAME)
                print(f"Successfully initialized Pinecone index: {settings.PINECONE_INDEX_NAME}")
            except Exception as e:
                print(f"Failed to initialize Pinecone client: {str(e)}")
        else:
            print("Pinecone API Key is not set. Pinecone services will be unavailable.")

    def get_index(self):
        return self.index

    def upsert_vector(self, vector_id: str, values: list[float], metadata: dict):
        """
        벡터 데이터를 Pinecone에 적재합니다.
        """
        if not self.index:
            raise RuntimeError("Pinecone index is not initialized.")
        return self.index.upsert(vectors=[(vector_id, values, metadata)])

    def query_similar_pois(self, vector: list[float], top_k: int = 5, filter_dict: dict = None):
        """
        사용자 선호 벡터와 POI 벡터 간 유사도 분석을 실행합니다.
        """
        if not self.index:
            raise RuntimeError("Pinecone index is not initialized.")
        return self.index.query(
            vector=vector,
            top_k=top_k,
            include_metadata=True,
            filter=filter_dict
        )

# 싱글톤 인스턴스
pinecone_client = PineconeWrapper()
