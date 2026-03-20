from fastapi import APIRouter, UploadFile, File, HTTPException
import cv2
import numpy as np

from app.config import settings
from app.models.schemas import ScanResponse, ErrorResponse
from app.services.image_processor import detect_card, detect_foot
from app.services.measurement import measure_foot
from app.services.size_matcher import get_recommendations

router = APIRouter()


@router.post("/scan", response_model=ScanResponse, responses={422: {"model": ErrorResponse}})
async def scan_foot(image: UploadFile = File(...)):
    # Validate file size
    contents = await image.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail="Image too large")

    # Decode image
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=422, detail={
            "error": "Could not read image",
            "error_code": "INVALID_IMAGE",
            "tips": ["Make sure you uploaded a valid image file (JPG, PNG)"]
        })

    # Stage 1: Detect credit card for calibration
    card_contour, pixels_per_mm, confidence_card = detect_card(img)
    if card_contour is None:
        raise HTTPException(status_code=422, detail={
            "error": "Could not detect the credit card in the image",
            "error_code": "CARD_NOT_DETECTED",
            "tips": [
                "Place your credit card flat on the floor next to your foot",
                "Make sure the entire card is visible",
                "Use good lighting and avoid shadows on the card",
                "The card should contrast with the floor surface"
            ]
        })

    # Stage 2: Detect foot (excluding the card region)
    foot_contour, confidence_foot = detect_foot(img, card_contour, pixels_per_mm)
    if foot_contour is None:
        raise HTTPException(status_code=422, detail={
            "error": "Could not detect your foot in the image",
            "error_code": "FOOT_NOT_DETECTED",
            "tips": [
                "Place your bare foot flat on the floor next to the card",
                "Take the photo from directly above",
                "Make sure your entire foot is in the frame",
                "Use good lighting so your foot stands out from the floor"
            ]
        })

    # Stage 3: Measure foot
    length_mm, width_mm = measure_foot(foot_contour, pixels_per_mm)
    confidence = (confidence_card + confidence_foot) / 2

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
