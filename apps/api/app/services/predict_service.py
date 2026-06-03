"""혼잡 예측 서비스.

WP1: 추론 경로를 다단계 폴백으로 재구성한다.
  (a) Vertex AI Endpoint 호출  → source=vertex
  (b) GCS `models/model.pkl` 인메모리 추론 → source=gcs
  (c) 로컬 `model.pkl` 인메모리 추론 → source=local
  (d) 전부 실패/미학습 타입 → 0.5 → source=default

설계 원칙:
- import 시점에 절대 죽지 않는다(=lazy 로딩). VERTEX_ENDPOINT_ID/GCS/로컬 어느 것도
  없어도 서버는 뜨고, 예측은 0.5로 폴백한다.
- 외부 GCP(Vertex) 호출에는 타임아웃을 걸고, 실패 시 즉시 (b)로 내려간다.
- 외부 노출 함수 `predict_congestion(...)`의 시그니처·반환 타입은 변경하지 않는다.
"""

import os
import json
import pickle
import threading
from typing import Optional, Tuple, Any

import structlog

from app.core.config import settings, _resolve_adc_path

logger = structlog.get_logger()

# 시설 카테고리 (학습 스펙과 동일하게 인코더가 fit된 3개 피처: [norm_type, hour_str, dow_str])
DEFAULT_CONGESTION = 0.5

# --- lazy 캐시 (모듈 전역, 최초 사용 시 1회 로드) ---
_gcs_artifacts: Optional[Tuple[Any, Any]] = None      # (model, encoder)
_gcs_loaded = False
_local_artifacts: Optional[Tuple[Any, Any]] = None    # (model, encoder)
_local_loaded = False
_vertex_endpoint = None
_vertex_init_attempted = False

# 추천 채점이 후보를 병렬(asyncio.to_thread)로 돌리므로, 최초 1회 lazy 로드가 여러 워커
# 스레드에서 동시에 들어올 수 있다. 중복 초기화/경쟁을 막기 위한 락(double-checked locking).
_init_lock = threading.Lock()


def _resolve_project_id() -> str:
    """ENV=production이면 ADC가 프로젝트를 결정하므로 settings 값 사용,
    로컬에선 ADC json의 quota_project_id를 우선 사용(기존 동작 계승)."""
    project_id = settings.GCP_PROJECT_ID
    if os.environ.get("ENV") != "production":
        adc_path = _resolve_adc_path()
        if os.path.exists(adc_path):
            try:
                with open(adc_path, "r", encoding="utf-8") as f:
                    cred = json.load(f)
                    if "quota_project_id" in cred:
                        project_id = cred["quota_project_id"]
            except Exception:
                pass
    return project_id


def normalize_facility_type(facility_type: str) -> str:
    if facility_type in ["restaurant", "cafe"]:
        return "cafeteria"
    elif facility_type == "gym":
        return "loading_dock"
    elif facility_type == "office":
        return "meeting_room"
    # 휴게 공간(rest_area)의 ML 학습 버킷은 loading_dock 이다.
    # (모델/Vertex Endpoint/BQML 을 재학습하지 않고 4번째 카테고리를 rest_area 로 개명하기 위한 매핑)
    elif facility_type in ["rest_area", "lounge"]:
        return "loading_dock"
    elif facility_type in ["cafeteria", "parking", "meeting_room", "loading_dock"]:
        return facility_type
    return facility_type


# --- (b) GCS 모델 lazy 로드 ---
def _load_gcs_artifacts() -> Optional[Tuple[Any, Any]]:
    global _gcs_artifacts, _gcs_loaded
    if _gcs_loaded:
        return _gcs_artifacts
    # 무거운 초기화(다운로드/역직렬화)를 락 안에서 완결하고, 캐시가 확정된 뒤에만 _gcs_loaded=True 로 둔다.
    # (플래그만 먼저 세우고 락 밖에서 채우면, 첫 동시 요청의 다른 스레드가 아직 None 인 캐시를 받는 race 발생)
    with _init_lock:
        if _gcs_loaded:
            return _gcs_artifacts
        try:
            from google.cloud import storage  # lazy import

            project_id = _resolve_project_id()
            if os.environ.get("ENV") == "production":
                storage_client = storage.Client()
            else:
                storage_client = storage.Client(project=project_id)

            bucket = storage_client.bucket(settings.GCS_BUCKET_NAME)
            blob = bucket.blob("models/model.pkl")
            model_data = pickle.loads(blob.download_as_bytes())
            _gcs_artifacts = (model_data["model"], model_data["encoder"])
            logger.info("predict_model_loaded", source="gcs", bucket=settings.GCS_BUCKET_NAME)
        except Exception as e:
            logger.warning("predict_model_load_failed", source="gcs", error=str(e))
            _gcs_artifacts = None
        _gcs_loaded = True
    return _gcs_artifacts


# --- (c) 로컬 모델 lazy 로드 ---
def _load_local_artifacts() -> Optional[Tuple[Any, Any]]:
    global _local_artifacts, _local_loaded
    if _local_loaded:
        return _local_artifacts
    with _init_lock:
        if _local_loaded:
            return _local_artifacts
        local_model_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "model.pkl",
        )
        try:
            if os.path.exists(local_model_path):
                with open(local_model_path, "rb") as f:
                    model_data = pickle.load(f)
                _local_artifacts = (model_data["model"], model_data["encoder"])
                logger.info("predict_model_loaded", source="local", path=local_model_path)
            else:
                _local_artifacts = None
        except Exception as e:
            logger.warning("predict_model_load_failed", source="local", error=str(e))
            _local_artifacts = None
        _local_loaded = True
    return _local_artifacts


def _predict_with_artifacts(artifacts: Tuple[Any, Any], norm_type: str, hour: int, dow: int) -> Optional[float]:
    """GCS/로컬 공통 인메모리 추론. 미학습 타입이면 None(상위에서 0.5 처리)."""
    model, encoder = artifacts
    # norm_type 과 대칭으로 hour/dow 도 학습 카테고리 멤버십을 검증한다. OneHotEncoder(handle_unknown='ignore')는
    # 미학습 hour/dow 를 0벡터로 만들어 '절편-only(평균) 예측'을 source=gcs/local '성공'처럼 반환하므로,
    # 미학습 시점은 None 으로 내려 0.5 폴백이 되게 한다(의미 없는 평균을 신뢰값으로 반환하지 않음).
    # len<3 가드는 다른 피처 수의 인코더가 들어왔을 때의 IndexError 방지.
    if (
        not hasattr(encoder, "categories_")
        or len(encoder.categories_) < 3
        or norm_type not in encoder.categories_[0]
        or str(hour) not in encoder.categories_[1]
        or str(dow) not in encoder.categories_[2]
    ):
        return None
    try:
        # train.py의 OneHotEncoder가 fit된 포맷: [norm_type, hour_str, dow_str]
        features = [[norm_type, str(hour), str(dow)]]
        X_encoded = encoder.transform(features)
        prediction = model.predict(X_encoded)[0]
        return max(0.0, min(1.0, float(prediction)))
    except Exception as e:
        logger.warning("predict_inference_error", error=str(e))
        return None


# --- (a) Vertex AI Endpoint lazy init ---
def _get_vertex_endpoint():
    global _vertex_endpoint, _vertex_init_attempted
    if _vertex_init_attempted:
        return _vertex_endpoint
    with _init_lock:
        if _vertex_init_attempted:
            return _vertex_endpoint
        if not settings.VERTEX_ENDPOINT_ID:
            # WP1 비활성화: Endpoint 미배포 환경 → GCS 폴백 경로로 동작
            _vertex_init_attempted = True
            return None
        try:
            from google.cloud import aiplatform  # lazy import

            aiplatform.init(project=settings.GCP_PROJECT_ID, location=settings.VERTEX_LOCATION)
            _vertex_endpoint = aiplatform.Endpoint(settings.VERTEX_ENDPOINT_ID)
            logger.info(
                "vertex_endpoint_initialized",
                endpoint_id=settings.VERTEX_ENDPOINT_ID,
                location=settings.VERTEX_LOCATION,
            )
        except Exception as e:
            logger.warning("vertex_endpoint_init_failed", error=str(e))
            _vertex_endpoint = None
        # 캐시(또는 None)가 확정된 뒤에만 시도 완료 플래그를 세운다.
        _vertex_init_attempted = True
    return _vertex_endpoint


def _predict_with_vertex(norm_type: str, hour: int, dow: int) -> Optional[float]:
    """배포된 모델은 sklearn Pipeline(encoder→ridge)이므로 raw 피처를 보낸다.
    피처 포맷은 train.py 인코더 fit 스펙과 동일: [norm_type, hour_str, dow_str].
    타임아웃/오류 시 None 반환 → 상위에서 GCS로 폴백."""
    endpoint = _get_vertex_endpoint()
    if endpoint is None:
        return None
    try:
        instances = [[norm_type, str(hour), str(dow)]]
        response = endpoint.predict(
            instances=instances,
            timeout=settings.VERTEX_TIMEOUT_SECONDS,
        )
        preds = getattr(response, "predictions", None)
        if not preds:
            return None
        value = preds[0]
        # prebuilt sklearn 컨테이너는 스칼라 또는 [스칼라] 형태로 반환될 수 있음
        if isinstance(value, (list, tuple)):
            value = value[0]
        return max(0.0, min(1.0, float(value)))
    except Exception as e:
        logger.warning("vertex_predict_failed", error=str(e))
        return None


def predict_congestion(facility_type: str, hour: int, day_of_week: int) -> float:
    """도착 예상 시점 기준 혼잡도를 [0,1]로 반환.

    시그니처/반환 타입 불변 (score.py가 무수정 호출).
    경로: vertex → gcs → local → 0.5. 어느 경로를 탔는지 로깅한다.
    """
    norm_type = normalize_facility_type(facility_type)

    # (a) Vertex AI Endpoint
    result = _predict_with_vertex(norm_type, hour, day_of_week)
    if result is not None:
        logger.info("congestion_predicted", source="vertex", facility_type=norm_type, value=result)
        return result

    # (b) GCS 인메모리
    gcs = _load_gcs_artifacts()
    if gcs is not None:
        result = _predict_with_artifacts(gcs, norm_type, hour, day_of_week)
        if result is not None:
            logger.info("congestion_predicted", source="gcs", facility_type=norm_type, value=result)
            return result

    # (c) 로컬 인메모리
    local = _load_local_artifacts()
    if local is not None:
        result = _predict_with_artifacts(local, norm_type, hour, day_of_week)
        if result is not None:
            logger.info("congestion_predicted", source="local", facility_type=norm_type, value=result)
            return result

    # (d) 전부 실패/미학습 타입
    logger.info("congestion_predicted", source="default", facility_type=norm_type, value=DEFAULT_CONGESTION)
    return DEFAULT_CONGESTION
