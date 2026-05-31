# pyrefly: ignore [missing-import]
import asyncio
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.supabase import supabase_client, get_current_user
from app.services.pinecone_service import pinecone_service
from app.services.tttv.score import calculate_tttv_score
from app.services.tttv.travel import calculate_haversine_distance, WALKING_SPEED_M_PER_MIN
from app.services.tttv.preference import CATEGORY_VECTORS

logger = structlog.get_logger()
router = APIRouter(prefix="/api/v1", tags=["recommendations"])

# --- Request/Response Pydantic Models ---
class RecommendRequest(BaseModel):
    user_id: str
    original_facility_id: str
    user_lat: float
    user_lng: float

class RecommendItem(BaseModel):
    recommendation_id: str
    facility: dict
    tttv_score: float
    breakdown: dict
    distance_m: float

class FeedbackRequest(BaseModel):
    recommendation_id: str
    action: str  # accepted, rejected, ignored

# --- Helpers for async DB Calls ---
async def fetch_user(user_id: str):
    res = await asyncio.to_thread(
        supabase_client.table("users").select("*").eq("id", user_id).execute
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="사용자 정보를 찾을 수 없습니다.")
    return res.data[0]

async def fetch_facility(facility_id: str):
    res = await asyncio.to_thread(
        supabase_client.table("facilities").select("*").eq("id", facility_id).execute
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="시설 정보를 찾을 수 없습니다.")
    return res.data[0]

async def fetch_all_facilities():
    all_data = []
    limit = 1000
    start = 0
    while True:
        # Avoid lambda scope capture issues by specifying start/limit explicitly
        res = await asyncio.to_thread(
            lambda s=start, l=limit: supabase_client.table("facilities").select("*").range(s, s + l - 1).execute()
        )
        if not res.data:
            break
        all_data.extend(res.data)
        if len(res.data) < limit:
            break
        start += limit
    return all_data

async def fetch_latest_congestion(facility_id: str) -> float:
    """
    특정 시설의 가장 최신 congestion_level을 조회합니다. (없으면 기본값 0.0)
    """
    res = await asyncio.to_thread(
        supabase_client.table("congestion_logs")
        .select("congestion_level")
        .eq("facility_id", facility_id)
        .order("timestamp", desc=True)
        .limit(1)
        .execute
    )
    if res.data:
        return res.data[0]["congestion_level"]
    return 0.0


# --- Endpoints ---

@router.post("/recommendations", response_model=list[RecommendItem])
async def get_recommendations(
    req: RecommendRequest,
    current_user: dict = Depends(get_current_user)
):
    logger.info("recommendation_request_received", user_id=req.user_id, original_infra=req.original_facility_id)

    # 1. 사용자 정보 및 원본 시설 정보 병렬 조회
    user_task = fetch_user(req.user_id)
    original_infra_task = fetch_facility(req.original_facility_id)
    all_infra_task = fetch_all_facilities()
    
    user_info, original_infra, all_facilities = await asyncio.gather(
        user_task, original_infra_task, all_infra_task
    )

    # 원본 시설의 실시간 혼잡도 조회
    original_congestion = await fetch_latest_congestion(req.original_facility_id)

    # 2. 반경 150m 이내 후보 시설 필터링 (본인 시설 제외)
    candidates = []
    for f in all_facilities:
        if f["id"] == req.original_facility_id:
            continue
            
        distance = calculate_haversine_distance(
            req.user_lat, req.user_lng,
            f["latitude"], f["longitude"]
        )
        
        # 150미터 이내 시설만 후보군으로 포함
        if distance <= 150.0:
            candidates.append((f, distance))

    logger.info("candidates_filtered", count=len(candidates), max_radius_m=150)

    # 3. 각 후보군에 대해 TTTV 스코어 비동기 연산
    recommendation_results = []
    for f, dist in candidates:
        candidate_congestion = await fetch_latest_congestion(f["id"])
        
        # 스코어 계산
        score_res = await calculate_tttv_score(
            user_id=req.user_id,
            preferred_categories=user_info.get("preferred_categories", []),
            original_facility_type=original_infra["type"],
            original_congestion_level=original_congestion,
            candidate_facility=f,
            candidate_congestion_level=candidate_congestion,
            user_lat=req.user_lat,
            user_lng=req.user_lng
        )
        
        recommendation_results.append({
            "facility": f,
            "tttv_score": score_res.score,
            "breakdown": score_res.breakdown,
            "distance_m": dist
        })

    # 4. 스코어 기준 내림차순 정렬 및 상위 3개 선별
    recommendation_results.sort(key=lambda x: x["tttv_score"], reverse=True)
    top_3 = recommendation_results[:3]

    # 5. DB(recommendations)에 추천 이력 저장 후 recommendation_id 획득 및 응답 매핑
    response_items = []
    for item in top_3:
        # DB 이력 추가
        db_res = await asyncio.to_thread(
            supabase_client.table("recommendations").insert({
                "user_id": req.user_id,
                "original_facility_id": req.original_facility_id,
                "recommended_facility_id": item["facility"]["id"],
                "tttv_score": item["tttv_score"],
                "score_breakdown": item["breakdown"],
                "accepted": False
            }).execute
        )
        
        rec_id = db_res.data[0]["id"] if db_res.data else "mock-rec-id"
        
        response_items.append(RecommendItem(
            recommendation_id=rec_id,
            facility=item["facility"],
            tttv_score=item["tttv_score"],
            breakdown=item["breakdown"],
            distance_m=item["distance_m"]
        ))

    logger.info("recommendations_generated", count=len(response_items))
    return response_items


@router.post("/feedback")
async def submit_feedback(
    req: FeedbackRequest,
    current_user: dict = Depends(get_current_user)
):
    logger.info("feedback_received", recommendation_id=req.recommendation_id, action=req.action)

    # 1. 기존 추천 이력 조회
    rec_res = await asyncio.to_thread(
        supabase_client.table("recommendations").select("*, recommended_facility:facilities(*)").eq("id", req.recommendation_id).execute
    )
    if not rec_res.data:
        raise HTTPException(status_code=404, detail="해당 추천 기록을 찾을 수 없습니다.")
    
    recommendation = rec_res.data[0]
    user_id = recommendation["user_id"]
    facility = recommendation.get("recommended_facility")
    if not facility:
        # facilities를 조인하지 못했을 시 단독으로 시설 추가 조회
        facility = await fetch_facility(recommendation["recommended_facility_id"])

    # 2. user_feedback 이력 저장
    await asyncio.to_thread(
        supabase_client.table("user_feedback").insert({
            "user_id": user_id,
            "recommendation_id": req.recommendation_id,
            "action": req.action
        }).execute
    )

    # 3. 수락 행동인 경우 recommendations 테이블의 accepted 여부 업데이트
    if req.action == "accepted":
        await asyncio.to_thread(
            supabase_client.table("recommendations")
            .update({"accepted": True})
            .eq("id", req.recommendation_id)
            .execute
        )

    # 4. Pinecone 사용자 선호도 벡터 학습 보정
    # 시설 특성 및 카테고리에 맞는 기본 벡터 획득
    facility_type = facility["type"]
    facility_vector = CATEGORY_VECTORS.get(facility_type, [0.0] * 8)
    
    # 피드백 학습 반영
    await pinecone_service.adjust_user_vector_on_feedback(
        user_id=user_id,
        facility_vector=facility_vector,
        action=req.action
    )

    logger.info("feedback_processed_and_vector_updated", user_id=user_id)
    return {"success": True, "updated_vector": True}
