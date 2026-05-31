from typing import List, Union
# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, field_validator

class Settings(BaseSettings):
    ENV: str = "development"
    PROJECT_NAME: str = "InduSpot API"
    
    # Supabase Settings
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    JWT_SECRET: str  # Supabase JWT 검증용 비밀키
    GCS_BUCKET_NAME: str

    @property
    def SUPABASE_KEY(self) -> str:
        return self.SUPABASE_SERVICE_ROLE_KEY or self.SUPABASE_ANON_KEY

    # --- GCP / Vertex AI Settings (WP1) ---
    # 공통 GCP 프로젝트 (비밀 아님 → 기본값 허용)
    GCP_PROJECT_ID: str = "knudc-henryseo711"
    # Vertex/BigQuery/Pub-Sub 리소스 리전 (기존 Cloud Run 리전과 통일)
    VERTEX_LOCATION: str = "us-central1"
    # 배포된 혼잡 예측 Endpoint의 숫자 ID. 비어 있으면 WP1 비활성화(=GCS 폴백 경로 사용).
    VERTEX_ENDPOINT_ID: str = ""
    # Vertex Endpoint 호출 타임아웃(초)
    VERTEX_TIMEOUT_SECONDS: float = 5.0

    # --- Gemini Settings (WP3) ---
    # 추천 사유 생성 모델. 비어 있으면 WP3 비활성화(=템플릿 폴백).
    GEMINI_MODEL: str = "gemini-2.0-flash-001"
    GEMINI_ENABLED: bool = False
    GEMINI_TIMEOUT_SECONDS: float = 4.0

    # --- BigQuery Settings (WP2) ---
    BQ_DATASET: str = "induspot"
    BQ_LOCATION: str = "US"

    # --- Pub/Sub Settings (WP4) ---
    PUBSUB_TOPIC: str = "induspot-congestion"
    PUBSUB_PUSH_SUBSCRIPTION: str = "induspot-congestion-push"
    # push 요청 OIDC 토큰 검증에 기대하는 서비스 계정 이메일. 비어 있으면 검증 생략(개발용).
    PUBSUB_PUSH_SERVICE_ACCOUNT: str = ""
    # push 요청 OIDC 토큰의 기대 audience (보통 Cloud Run /ingest/pubsub URL). 비어 있으면 audience 미검증.
    PUBSUB_PUSH_AUDIENCE: str = ""

    # Pinecone Settings
    PINECONE_API_KEY: str = ""
    PINECONE_INDEX_NAME: str = "induspot-poi-index"

    # CORS Settings
    ALLOWED_ORIGINS: Union[str, List[str]] = ["http://localhost:3000"]

    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings(_env_file=".env")
# 만약 로컬에 .env가 없을 때 fallback이나 유연한 구동을 위해 settings 인스턴스를 선언하되,
# 실제로 런타임에 에러가 발생할 수 있으므로, 테스트 구동을 위해 예외 처리를 유연하게 하거나 설정 파일에 기본값을 주는 것도 방법입니다.
# 여기서는 default=None이나 빈 값을 주지 않고, 필수값은 그대로 두어 환경 설정을 강제하겠습니다.
