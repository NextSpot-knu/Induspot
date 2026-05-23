import asyncio
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.supabase import supabase_client

logger = structlog.get_logger()
router = APIRouter(prefix="/api/v1", tags=["infrastructures"])

class CongestionInfo(BaseModel):
    level: float
    current_count: int
    timestamp: str | None

class InfrastructureItem(BaseModel):
    id: str
    name: str
    type: str
    latitude: float
    longitude: float
    capacity: int
    operating_hours: dict | None
    features: dict | None
    congestion: CongestionInfo | None

async def fetch_latest_congestion_for_all(facility_ids: list[str]) -> dict:
    if not facility_ids:
        return {}
    try:
        res = await asyncio.to_thread(
            supabase_client.table("congestion_logs")
            .select("facility_id, congestion_level, current_count, timestamp")
            .in_("facility_id", facility_ids)
            .order("timestamp", desc=True)
            .execute
        )
        latest: dict = {}
        for row in res.data:
            fid = row["facility_id"]
            if fid not in latest:
                latest[fid] = {
                    "level": row["congestion_level"],
                    "current_count": row["current_count"],
                    "timestamp": row["timestamp"],
                }
        return latest
    except Exception as e:
        logger.warning("congestion_fetch_failed", error=str(e))
        return {}

@router.get("/infrastructures", response_model=list[InfrastructureItem])
async def get_infrastructures(
    type: str | None = None,
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lng: float | None = None,
    max_lng: float | None = None,
):
    logger.info("infrastructures_request", type=type)
    try:
        query = supabase_client.table("facilities").select("*")
        if type:
            query = query.eq("type", type)
        if min_lat is not None:
            query = query.gte("latitude", min_lat)
        if max_lat is not None:
            query = query.lte("latitude", max_lat)
        if min_lng is not None:
            query = query.gte("longitude", min_lng)
        if max_lng is not None:
            query = query.lte("longitude", max_lng)

        res = await asyncio.to_thread(query.execute)
        facilities = res.data
        if not facilities:
            return []

        facility_ids = [f["id"] for f in facilities]
        congestion_map = await fetch_latest_congestion_for_all(facility_ids)

        result = []
        for f in facilities:
            congestion_data = congestion_map.get(f["id"])
            congestion = CongestionInfo(**congestion_data) if congestion_data else None
            result.append(InfrastructureItem(
                id=f["id"],
                name=f["name"],
                type=f["type"],
                latitude=f["latitude"],
                longitude=f["longitude"],
                capacity=f["capacity"],
                operating_hours=f.get("operating_hours"),
                features=f.get("features"),
                congestion=congestion,
            ))

        logger.info("infrastructures_returned", count=len(result))
        return result
    except Exception as e:
        logger.error("infrastructures_fetch_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"시설 데이터 조회 실패: {str(e)}")