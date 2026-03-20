import cv2
import numpy as np


def measure_foot(contour, pixels_per_mm):
    """
    Measure foot length and width from contour.

    Args:
        contour: OpenCV contour of the foot
        pixels_per_mm: calibration factor from A4 paper detection

    Returns:
        (length_mm, width_mm)
    """
    # Get minimum area bounding rectangle
    rect = cv2.minAreaRect(contour)
    (cx, cy), (w, h), angle = rect

    # Length = longer dimension, width = shorter dimension
    length_px = max(w, h)
    width_px = min(w, h)

    length_mm = length_px / pixels_per_mm
    width_mm = width_px / pixels_per_mm

    # Sanity check: foot length typically 150-350mm, width 60-120mm
    if length_mm < 100 or length_mm > 400:
        # Try convex hull for a tighter fit
        hull = cv2.convexHull(contour)
        rect2 = cv2.minAreaRect(hull)
        (_, _), (w2, h2), _ = rect2
        length_px = max(w2, h2)
        width_px = min(w2, h2)
        length_mm = length_px / pixels_per_mm
        width_mm = width_px / pixels_per_mm

    return length_mm, width_mm
