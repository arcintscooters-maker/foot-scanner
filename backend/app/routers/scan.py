from fastapi import APIRouter, UploadFile, File, HTTPException

from app.config import settings
from app.models.schemas import ScanResponse, ErrorResponse
from app.services.image_processor import analyze_foot_image
from app.services.size_matcher import get_recommendations

router = APIRouter()

# Map file extensions to media types
MEDIA_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


@router.post("/scan", response_model=ScanResponse, responses={422: {"model": ErrorResponse}})
async def scan_foot(image: UploadFile = File(...)):
    # Validate file size
    contents = await image.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail="Image too large")

    # Determine media type
    ext = (image.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    media_type = MEDIA_TYPES.get(ext, "image/jpeg")

    # Analyze with Claude Vision
    try:
        result = analyze_foot_image(contents, media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": f"Analysis failed: {str(e)}",
            "error_code": "ANALYSIS_ERROR",
            "tips": ["Please try again with a clearer photo"]
        })

    # Check for detection errors
    if "error" in result:
        error_code = result["error"]
        message = result.get("message", "Detection failed")

        if error_code == "CARD_NOT_DETECTED":
            tips = [
                "Place your credit/debit card flat on the floor next to your foot",
                "Make sure the entire card is visible in the photo",
                "Use good lighting and avoid shadows on the card",
                "The card should contrast with the floor surface",
            ]
        elif error_code == "FOOT_NOT_DETECTED":
            tips = [
                "Place your bare foot flat on the floor next to the card",
                "Take the photo from directly above",
                "Make sure your entire foot is in the frame",
                "Use good lighting so your foot stands out from the floor",
            ]
        else:
            tips = ["Please try again with a clearer photo"]

        raise HTTPException(status_code=422, detail={
            "error": message,
            "error_code": error_code,
            "tips": tips,
        })

    # Extract measurements
    length_mm = result["foot_length_mm"]
    width_mm = result["foot_width_mm"]
    confidence = result.get("confidence", 0.7)

    # Get size recommendations
    recommendations = get_recommendations(length_mm, width_mm)

    return ScanResponse(
        scan={
            "foot_length_mm": round(length_mm, 1),
            "foot_width_mm": round(width_mm, 1),
            "foot_length_cm": round(length_mm / 10, 1),
            "foot_width_cm": round(width_mm / 10, 1),
            "confidence": round(confidence, 2),
        },
        recommendations=recommendations,
    )
