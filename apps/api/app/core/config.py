import os
import json
from typing import List, Union
# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

class Settings(BaseSettings):
    ENV: str = "development"
    PROJECT_NAME: str = "InduSpot API"
    
    # Supabase Settings
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    JWT_SECRET: str  # Supabase JWT 검증용 비밀키
    GCS_BUCKET_NAME: str = ""

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
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"
    GEMINI_ENABLED: bool = False
    GEMINI_TIMEOUT_SECONDS: float = 4.0

    # --- BigQuery Settings (WP2) ---
    BQ_DATASET: str = "induspot"
    # 리전은 Vertex/Cloud Run과 통일(us-central1). BQML ARIMA_PLUS 지원 리전.
    BQ_LOCATION: str = "us-central1"

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

    # Kakao Mobility Directions API (도보/차량 실거리·실시간 이동시간).
    # 비어 있으면 Haversine 직선거리 도보 환산으로 폴백(기본). 키가 있으면 실경로 호출.
    KAKAO_REST_API_KEY: str = ""

    # CORS Settings
    # 기본값은 와일드카드(미설정 환경에서 프런트가 막히지 않도록). 운영에서는 실제 도메인을
    # 콤마로 지정하면 main.py 가 자동으로 엄격 모드(해당 오리진만 + credentials)로 전환한다.
    ALLOWED_ORIGINS: Union[str, List[str]] = ["*"]

    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            # 빈 토큰 제거 후, 결과가 비면 와일드카드로 폴백.
            # (ALLOWED_ORIGINS="" 같은 빈 환경변수가 [''] 가 되어 모든 오리진이 조용히 차단되는 footgun 방지)
            parts = [i.strip() for i in v.split(",") if i.strip()]
            return parts or ["*"]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

def load_gcp_secrets():
    # Only load if we can resolve GCP project ID or fallback to standard project
    project_id = "knudc-henryseo711"
    adc_path = os.path.join(os.environ.get("APPDATA", ""), "gcloud", "application_default_credentials.json")
    if os.path.exists(adc_path):
        try:
            with open(adc_path, "r", encoding="utf-8") as f:
                cred = json.load(f)
                if "quota_project_id" in cred:
                    project_id = cred["quota_project_id"]
        except Exception:
            pass

    try:
        from google.cloud import secretmanager
        client = secretmanager.SecretManagerServiceClient()
        
        secret_keys = [
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "JWT_SECRET",
            "GCS_BUCKET_NAME",
            "PINECONE_API_KEY",
            "PINECONE_INDEX_NAME"
        ]
        
        print(f"Attempting to load secrets from GCP Secret Manager in project: {project_id}...")
        for key in secret_keys:
            # Keep existing environment values if already defined
            if os.environ.get(key):
                continue
            try:
                name = f"projects/{project_id}/secrets/{key}/versions/latest"
                response = client.access_secret_version(request={"name": name})
                val = response.payload.data.decode("UTF-8").strip()
                if val:
                    os.environ[key] = val
                    print(f"Successfully loaded {key} from GCP Secret Manager.")
            except Exception:
                # Fallback silently to .env/dotenv
                pass
    except Exception as e:
        print(f"GCP Secret Manager client not loaded or failed: {e}")

# Load secrets from GCP Secret Manager before instantiating settings
load_gcp_secrets()

settings = Settings(_env_file=".env")
# 만약 로컬에 .env가 없을 때 fallback이나 유연한 구동을 위해 settings 인스턴스를 선언하되,
# 실제로 런타임에 에러가 발생할 수 있으므로, 테스트 구동을 위해 예외 처리를 유연하게 하거나 설정 파일에 기본값을 주는 것도 방법입니다.
# 여기서는 default=None이나 빈 값을 주지 않고, 필수값은 그대로 두어 환경 설정을 강제하겠습니다.
