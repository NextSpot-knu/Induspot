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
    GCP_PROJECT_ID: str = ""
    # Vertex/BigQuery/Pub-Sub 리소스 리전 (기존 Cloud Run 리전과 통일)
    VERTEX_LOCATION: str = "us-central1"
    # 배포된 혼잡 예측 Endpoint의 숫자 ID. 비어 있으면 WP1 비활성화(=GCS 폴백 경로 사용).
    VERTEX_ENDPOINT_ID: str = ""
    # Vertex Endpoint 호출 타임아웃(초)
    VERTEX_TIMEOUT_SECONDS: float = 5.0

    # --- Gemini Settings (WP3) ---
    # 추천 사유 생성 모델. 비어 있으면 WP3 비활성화(=템플릿 폴백).
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"
    GEMINI_API_KEY: str = ""
    GEMINI_ENABLED: bool = False
    # 콜드 스타트(Cloud Run 스케일제로 후 첫 호출)는 모델 첫 추론이 4초를 넘겨 timeout→unknown 이 된다.
    # 워밍업 후엔 ~1~2초라 평소 영향 없음. 첫 호출 안정성 위해 헤드룸 확보.
    GEMINI_TIMEOUT_SECONDS: float = 8.0

    # --- BigQuery Settings (WP2) ---
    BQ_DATASET: str = "induspot"
    # 리전은 Vertex/Cloud Run과 통일(us-central1). BQML ARIMA_PLUS 지원 리전.
    BQ_LOCATION: str = "us-central1"
    # 공유 BigQuery 헬퍼(core.bigquery)가 쓰는 테이블명. 스트리밍 인서트 싱크 + 예측 lookup.
    BQ_CONGESTION_TABLE: str = "congestion_logs"
    BQ_FORECAST_TABLE: str = "congestion_forecast_lookup"

    # --- Pub/Sub Settings (WP4) ---
    PUBSUB_TOPIC: str = "induspot-congestion"
    PUBSUB_PUSH_SUBSCRIPTION: str = "induspot-congestion-push"
    # push 요청 OIDC 토큰 검증에 기대하는 서비스 계정 이메일. 비어 있으면 검증 생략(개발용).
    PUBSUB_PUSH_SERVICE_ACCOUNT: str = ""
    # push 요청 OIDC 토큰의 기대 audience (보통 Cloud Run /ingest/pubsub URL). 비어 있으면 audience 미검증.
    PUBSUB_PUSH_AUDIENCE: str = ""

    # --- Firestore (사용자 선호 벡터 저장소; Pinecone 대체) ---
    # 8차원 선호 벡터를 user_id 로 저장/조회(KV). ADC 인증, 기본 DB 사용.
    FIRESTORE_DATABASE: str = "(default)"
    FIRESTORE_COLLECTION: str = "user_preference_vectors"

    # --- 의미 검색 임베딩 (음성 필터 retrieval; RAG의 검색 단계) ---
    # 식당 프로필(이름+종류+대표메뉴)을 Vertex 임베딩으로 벡터화해 Firestore 에 저장하고,
    # 발화("짜장면 먹고싶어")를 임베딩해 코사인 최근접으로 후보를 좁힌다(Gemini=의도/대화 분리).
    # 비어 있으면(False) 음성 필터는 Gemini match_ids 만 사용(임베딩 미사용).
    EMBEDDING_ENABLED: bool = False
    # Vertex 다국어 텍스트 임베딩 모델(한국어 지원, 768차원).
    EMBEDDING_MODEL: str = "text-multilingual-embedding-002"
    # 콜드 스타트 첫 임베딩 호출 헤드룸(모델 init 은 타임아웃 밖이지만 첫 RPC 가 느릴 수 있음).
    EMBEDDING_TIMEOUT_SECONDS: float = 6.0
    # 식당 문서 벡터 캐시 컬렉션. seed 스크립트가 채우고 런타임이 읽어 캐시한다.
    FIRESTORE_EMBEDDING_COLLECTION: str = "facility_embeddings"
    # 필터 선택 규칙: 절대 임계값이 아니라 '최고점 대비 margin' 안의 후보를 top_k 개까지.
    # (다국어 임베딩 코사인은 0.6~0.82 로 압축돼 절대 임계값은 변별력이 없음 — 실측 보정값.
    #  margin 0.04 = '고깃집' 확장검색이 실제 고깃집 2곳만 집고 닭갈비/곱창집은 배제하는 지점)
    VOICE_VECTOR_MARGIN: float = 0.04
    # 자유발화(분류 미상) 의미검색 결과 상한. 정밀분류가 잡히면(중식/고깃집 등) filter_candidates 가
    # 그 분류 후보를 '전부' 반환하므로(대안 리밋 해제) 이 값은 분류 미상 케이스에만 적용된다.
    VOICE_VECTOR_TOPK: int = 10
    # 무관 꼬리 차단용 보수적 절대 코사인 하한(다국어 임베딩 대역 0.6~0.82 하단). 진짜 매칭은 거의 안 비우며
    # 무관 후보만 자른다. 라이브 코사인 분포 로깅(embedding_filter_resolved.top) 후 0.68~0.72 로 상향 가능.
    VOICE_VECTOR_MIN_COSINE: float = 0.60
    # Gemini intent_category 와 시드 정밀분류(category)가 일치하는 후보에 주는 소프트 부스트(배타 게이트 아님 — category 없는 후보는 배제하지 않음).
    VOICE_CATEGORY_BOOST: float = 0.05

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

    @field_validator("JWT_SECRET")
    @classmethod
    def _nonempty_jwt_secret(cls, v: str) -> str:
        # 빈 JWT_SECRET 은 모든 워커 인증을 깨뜨린다(빈 HMAC 키 → 정상 토큰도 검증 실패).
        # 런타임 401/500 으로 미루지 말고 부팅 시점에 명확히 실패시켜 설정 누락을 조기 발견한다.
        if not v or not v.strip():
            raise ValueError("JWT_SECRET must be a non-empty secret")
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


def _resolve_adc_path() -> str:
    """ADC(Application Default Credentials) 파일 경로를 크로스플랫폼으로 해석한다.
    CLOUDSDK_CONFIG 우선, 없으면 Windows=%APPDATA%/gcloud, 그 외=~/.config/gcloud.
    (기존엔 APPDATA 만 봐 리눅스/맥 빌드에서 항상 폴백되던 footgun 제거.)"""
    base = os.environ.get("CLOUDSDK_CONFIG") or (
        os.path.join(os.environ.get("APPDATA", ""), "gcloud")
        if os.name == "nt"
        else os.path.expanduser("~/.config/gcloud")
    )
    return os.path.join(base, "application_default_credentials.json")


def load_gcp_secrets():
    # Disabled for Zero-Cost migration. Secrets are loaded directly from .env.
    pass

# Load secrets from GCP Secret Manager before instantiating settings
load_gcp_secrets()

settings = Settings(_env_file=".env")
# 만약 로컬에 .env가 없을 때 fallback이나 유연한 구동을 위해 settings 인스턴스를 선언하되,
# 실제로 런타임에 에러가 발생할 수 있으므로, 테스트 구동을 위해 예외 처리를 유연하게 하거나 설정 파일에 기본값을 주는 것도 방법입니다.
# 여기서는 default=None이나 빈 값을 주지 않고, 필수값은 그대로 두어 환경 설정을 강제하겠습니다.
