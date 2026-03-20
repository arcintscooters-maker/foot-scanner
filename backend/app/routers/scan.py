from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import ScanResponse
from app.services.image_processor import calculate_measurements
from app.services.size_matcher import get_recommendations

router = APIRouter()


class Point(BaseModel):
    x: float
    y: float


class MeasureRequest(BaseModel):
    card_point1: Point
    card_point2: Point
    heel_point: Point
    toe_point: Point
    width_left: Point | None = None
    width_right: Point | None = None
    image_width: int = 0
    image_height: int = 0


@router.post("/measure", response_model=ScanResponse)
async def measure_foot(req: MeasureRequest):
    result = calculate_measurements(
        card_point1=req.card_point1.model_dump(),
        card_point2=req.card_point2.model_dump(),
        heel_point=req.heel_point.model_dump(),
        toe_point=req.toe_point.model_dump(),
        width_left=req.width_left.model_dump() if req.width_left else None,
        width_right=req.width_right.model_dump() if req.width_right else None,
        image_width=req.image_width,
        image_height=req.image_height,
    )

    if "error" in result:
        raise HTTPException(status_code=422, detail={
            "error": result["message"],
            "error_code": result["error"],
            "tips": ["Please re-mark the points carefully and try again"],
        })

    recommendations = get_recommendations(result["foot_length_mm"], result["foot_width_mm"])

    return ScanResponse(
        scan=result,
        recommendations=recommendations,
    )
