from fastapi import APIRouter, Query

from app.models.schemas import RecommendResponse
from app.services.size_matcher import get_recommendations

router = APIRouter()


@router.get("/recommend", response_model=RecommendResponse)
def recommend_size(
    length_mm: float = Query(..., gt=100, lt=400, description="Foot length in mm"),
    width_mm: float = Query(None, gt=50, lt=150, description="Foot width in mm"),
):
    recommendations = get_recommendations(length_mm, width_mm)
    return RecommendResponse(
        foot_length_mm=length_mm,
        foot_width_mm=width_mm or 0,
        recommendations=recommendations,
    )
