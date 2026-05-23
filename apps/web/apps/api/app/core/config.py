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
