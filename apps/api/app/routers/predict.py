from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.predict_service import predict_congestion

router = APIRouter(tags=["predict"])

class PredictRequest(BaseModel):
    facility_type: str = Field(..., description="Facility type (e.g., cafeteria, parking, gym, office)")
    hour: int = Field(..., ge=0, le=23, description="Hour of the day (0-23)")
    day_of_week: int = Field(..., ge=0, le=6, description="Day of the week (0-6, where 0=Monday, 6=Sunday)")

class PredictResponse(BaseModel):
    predicted_congestion: float

@router.post("", response_model=PredictResponse)
def predict_endpoint(req: PredictRequest):
    pred = predict_congestion(req.facility_type, req.hour, req.day_of_week)
    return PredictResponse(predicted_congestion=pred)
