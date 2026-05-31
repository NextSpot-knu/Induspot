from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.supabase import get_current_user
from app.core.logging import setup_logging
from app.routers import recommendations, infrastructures, predict


# 로깅 설정 초기화
setup_logging()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="InduSpot 스마트 공단 인프라 수요 분산 AI 엔진 API",
    version="0.1.0"
)


#CORS 설정 //  app = FastAPI() 선언문 하단에 정확히 삽입하십시오.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 연결
app.include_router(recommendations.router)
app.include_router(infrastructures.router)
app.include_router(predict.router, prefix="/predict")

# 1. Health Check Endpoint
@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "environment": settings.ENV
    }

# 2. 테스트용 보호된 엔드포인트 (JWT 검증 데모)
@app.get("/api/v1/auth-test")
def auth_test(current_user: dict = Depends(get_current_user)):
    return {
        "message": "인증에 성공했습니다.",
        "user_id": current_user["id"],
        "email": current_user["email"],
        "role": current_user["role"]
    }

# 3. TTTV(Total Time to Value) 추천 예시 API
@app.get("/api/v1/recommendations/tttv")
def get_tttv_recommendation(
    infra_id: str,
    current_user: dict = Depends(get_current_user)
):
    # 실제로는 DB 조회 및 ML/수학적 계산 수행
    # 여기선 데모 목업 데이터를 반환
    return {
        "requested_infra_id": infra_id,
        "recommended_infra_id": "south-dock-a",
        "recommended_infra_name": "남부 하역장 A구역",
        "original_estimated_wait_time": 45,  # 분
        "recommended_estimated_wait_time": 10,  # 분
        "travel_time_saved": 35,  # 분
        "reason": "현재 B구역에 대기 트럭이 8대 집중되어 있습니다. A구역으로 3분간 우회 시 즉시 하역이 가능하여 총 35분을 절약할 수 있습니다."
    }
