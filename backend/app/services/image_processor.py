import math

# Standard credit card dimensions (ISO/IEC 7810 ID-1)
CARD_WIDTH_MM = 85.6
CARD_HEIGHT_MM = 53.98


def calculate_measurements(card_point1: dict, card_point2: dict,
                           heel_point: dict, toe_point: dict,
                           width_left: dict | None = None,
                           width_right: dict | None = None,
                           image_width: int = 0, image_height: int = 0) -> dict:
    """
    Calculate foot measurements from user-tapped points on the image.

    The user marks:
    - Two ends of the credit card's long edge (for calibration)
    - Heel and toe points (for foot length)
    - Optionally, widest left and right points (for foot width)

    All coordinates are in pixels relative to the displayed image.
    """
    # Calculate pixel distance of the card's long edge
    card_px = _distance(card_point1, card_point2)

    if card_px < 10:
        return {"error": "CARD_TOO_SMALL", "message": "Card points are too close together. Please try again."}

    # The card's long edge = 85.6mm
    pixels_per_mm = card_px / CARD_WIDTH_MM

    # Foot length: heel to toe
    length_px = _distance(heel_point, toe_point)
    length_mm = length_px / pixels_per_mm

    # Foot width (optional)
    width_mm = 0
    if width_left and width_right:
        width_px = _distance(width_left, width_right)
        width_mm = width_px / pixels_per_mm

    # Sanity checks
    if length_mm < 100 or length_mm > 400:
        return {
            "error": "MEASUREMENT_IMPLAUSIBLE",
            "message": f"Foot length of {length_mm:.0f}mm seems incorrect. Please re-mark the points carefully."
        }

    confidence = 0.95  # Manual marking is high confidence

    return {
        "foot_length_mm": round(length_mm, 1),
        "foot_width_mm": round(width_mm, 1),
        "foot_length_cm": round(length_mm / 10, 1),
        "foot_width_cm": round(width_mm / 10, 1),
        "confidence": confidence,
    }


def _distance(p1: dict, p2: dict) -> float:
    """Euclidean distance between two points."""
    return math.sqrt((p2["x"] - p1["x"]) ** 2 + (p2["y"] - p1["y"]) ** 2)
