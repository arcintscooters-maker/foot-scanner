import cv2
import numpy as np


# Standard credit card dimensions (ISO/IEC 7810 ID-1)
CARD_WIDTH_MM = 85.6
CARD_HEIGHT_MM = 53.98
CARD_ASPECT_RATIO = CARD_WIDTH_MM / CARD_HEIGHT_MM  # ~1.586

# Tolerance for aspect ratio matching
ASPECT_TOLERANCE = 0.25


def order_points(pts):
    """Order 4 points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def detect_card(img):
    """
    Detect a credit card in the image for size calibration.

    Returns:
        (card_contour, pixels_per_mm, confidence) or (None, None, 0) if not found.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    img_area = img.shape[0] * img.shape[1]

    best_contour = None
    best_score = 0
    best_ppm = 0

    for canny_low, canny_high in [(30, 100), (50, 150), (75, 200)]:
        edges = cv2.Canny(blurred, canny_low, canny_high)
        kernel = np.ones((3, 3), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:15]:
            area = cv2.contourArea(contour)
            area_ratio = area / img_area

            # Card should be roughly 1-20% of image area
            if area_ratio < 0.005 or area_ratio > 0.25:
                continue

            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

            if len(approx) != 4:
                continue

            # Check if it's rectangular (all angles ~90 degrees)
            pts = approx.reshape(4, 2).astype("float32")
            ordered = order_points(pts)

            w = np.linalg.norm(ordered[1] - ordered[0])
            h = np.linalg.norm(ordered[3] - ordered[0])
            if w == 0 or h == 0:
                continue

            aspect = max(w, h) / min(w, h)

            # Check aspect ratio matches a credit card (~1.586)
            if abs(aspect - CARD_ASPECT_RATIO) > ASPECT_TOLERANCE:
                continue

            # Score: prefer contours with aspect ratio closest to credit card
            aspect_score = 1.0 - abs(aspect - CARD_ASPECT_RATIO) / ASPECT_TOLERANCE
            area_score = min(area_ratio * 20, 1.0)  # prefer larger detections
            score = aspect_score * 0.7 + area_score * 0.3

            if score > best_score:
                best_score = score
                best_contour = approx

                # Calculate pixels_per_mm from the longer side (card width = 85.6mm)
                longer_px = max(w, h)
                best_ppm = longer_px / CARD_WIDTH_MM

    # Fallback: try adaptive threshold
    if best_contour is None:
        for block_size in [11, 15, 21]:
            thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                           cv2.THRESH_BINARY, block_size, 2)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:15]:
                area = cv2.contourArea(contour)
                area_ratio = area / img_area
                if area_ratio < 0.005 or area_ratio > 0.25:
                    continue

                peri = cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
                if len(approx) != 4:
                    continue

                pts = approx.reshape(4, 2).astype("float32")
                ordered = order_points(pts)
                w = np.linalg.norm(ordered[1] - ordered[0])
                h = np.linalg.norm(ordered[3] - ordered[0])
                if w == 0 or h == 0:
                    continue

                aspect = max(w, h) / min(w, h)
                if abs(aspect - CARD_ASPECT_RATIO) > ASPECT_TOLERANCE:
                    continue

                longer_px = max(w, h)
                best_ppm = longer_px / CARD_WIDTH_MM
                best_contour = approx
                best_score = 0.5
                break
            if best_contour is not None:
                break

    if best_contour is None:
        return None, None, 0.0

    confidence = min(1.0, best_score)
    return best_contour, best_ppm, confidence


def detect_foot(img, card_contour, pixels_per_mm):
    """
    Detect foot in the image, excluding the credit card region.

    The foot is the largest contour that isn't the card, with a foot-like aspect ratio.

    Returns:
        (foot_contour, confidence) or (None, 0) if not found.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    img_area = img.shape[0] * img.shape[1]

    # Create a mask to exclude the card region
    card_mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.fillPoly(card_mask, [card_contour.reshape(-1, 2)], 255)
    card_mask = cv2.dilate(card_mask, np.ones((15, 15), np.uint8), iterations=1)

    best_contour = None
    best_score = 0

    # Method 1: Edge-based detection
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    for canny_low, canny_high in [(20, 80), (40, 120), (60, 160)]:
        edges = cv2.Canny(blurred, canny_low, canny_high)
        # Remove card edges
        edges[card_mask > 0] = 0
        kernel = np.ones((5, 5), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=2)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=3)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            score = _score_foot_contour(contour, img_area, card_mask, pixels_per_mm)
            if score > best_score:
                best_score = score
                best_contour = contour

    # Method 2: Threshold-based (dark object on lighter floor)
    for thresh_val in [100, 130, 160]:
        _, thresh = cv2.threshold(blurred, thresh_val, 255, cv2.THRESH_BINARY_INV)
        thresh[card_mask > 0] = 0
        kernel = np.ones((7, 7), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            score = _score_foot_contour(contour, img_area, card_mask, pixels_per_mm)
            if score > best_score:
                best_score = score
                best_contour = contour

    # Method 3: HSV skin detection
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_skin = np.array([0, 20, 50], dtype=np.uint8)
    upper_skin = np.array([35, 180, 255], dtype=np.uint8)
    skin_mask = cv2.inRange(hsv, lower_skin, upper_skin)
    skin_mask[card_mask > 0] = 0

    kernel = np.ones((7, 7), np.uint8)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in contours:
        score = _score_foot_contour(contour, img_area, card_mask, pixels_per_mm)
        # Slightly lower confidence for skin detection
        score *= 0.85
        if score > best_score:
            best_score = score
            best_contour = contour

    if best_contour is None:
        return None, 0.0

    confidence = min(1.0, best_score)
    return best_contour, confidence


def _score_foot_contour(contour, img_area, card_mask, pixels_per_mm):
    """Score a contour on how likely it is to be a foot."""
    area = cv2.contourArea(contour)
    area_ratio = area / img_area

    # Foot should be 3-60% of image
    if area_ratio < 0.03 or area_ratio > 0.60:
        return 0

    # Check overlap with card — should be minimal
    contour_mask = np.zeros(card_mask.shape, dtype=np.uint8)
    cv2.fillPoly(contour_mask, [contour], 255)
    overlap = cv2.bitwise_and(contour_mask, card_mask)
    if np.sum(overlap) / max(np.sum(contour_mask), 1) > 0.2:
        return 0

    # Check aspect ratio (foot is elongated: 2.0 to 4.0)
    rect = cv2.minAreaRect(contour)
    w, h = rect[1]
    if w == 0 or h == 0:
        return 0
    aspect = max(w, h) / min(w, h)
    if aspect < 1.5 or aspect > 5.0:
        return 0

    # Check if measurements are plausible
    length_mm = max(w, h) / pixels_per_mm
    width_mm = min(w, h) / pixels_per_mm
    if length_mm < 150 or length_mm > 350:
        return 0
    if width_mm < 50 or width_mm > 130:
        return 0

    # Score: prefer foot-shaped aspect ratios and reasonable sizes
    aspect_score = 1.0 - abs(aspect - 2.8) / 2.0  # ideal foot aspect ~2.8
    aspect_score = max(0, min(1, aspect_score))

    size_score = 1.0 - abs(length_mm - 260) / 100  # ideal ~260mm
    size_score = max(0, min(1, size_score))

    area_score = min(area_ratio * 5, 1.0)

    return aspect_score * 0.4 + size_score * 0.3 + area_score * 0.3
