from fastapi import APIRouter, UploadFile, File, HTTPException
import cv2
import numpy as np

from app.config import settings
from app.models.schemas import ScanResponse, ErrorResponse
from app.services.image_processor import detect_a4_paper, detect_foot
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

    # Stage 1 & 2: Detect A4 paper and get calibrated (warped) image
    warped, pixels_per_mm, confidence_a4 = detect_a4_paper(img)
    if warped is None:
        raise HTTPException(status_code=422, detail={
            "error": "Could not detect A4 paper in the image",
            "error_code": "A4_NOT_DETECTED",
            "tips": [
                "Place the entire A4 paper on a dark/colored surface",
                "Make sure all 4 edges of the paper are visible",
                "Avoid shadows on the paper",
                "Take the photo from directly above"
            ]
        })

    # Stage 3: Detect foot on the warped image
    foot_contour, confidence_foot = detect_foot(warped)
    if foot_contour is None:
        raise HTTPException(status_code=422, detail={
            "error": "Could not detect foot in the image",
            "error_code": "FOOT_NOT_DETECTED",
            "tips": [
                "Place your bare foot fully on the A4 paper",
                "Make sure your foot is within the paper boundaries",
                "Use good lighting so your foot contrasts with the white paper"
            ]
        })

    # Stage 4: Measure foot
    length_mm, width_mm = measure_foot(foot_contour, pixels_per_mm)
    confidence = (confidence_a4 + confidence_foot) / 2

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
