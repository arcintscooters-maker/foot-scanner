import cv2
import numpy as np


# A4 paper dimensions in mm
A4_WIDTH_MM = 210.0
A4_HEIGHT_MM = 297.0

# Scale for warped output: pixels per mm
WARP_SCALE = 3.0
WARP_WIDTH = int(A4_WIDTH_MM * WARP_SCALE)
WARP_HEIGHT = int(A4_HEIGHT_MM * WARP_SCALE)


def order_points(pts):
    """Order 4 points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left has smallest sum
    rect[2] = pts[np.argmax(s)]   # bottom-right has largest sum
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # top-right has smallest difference
    rect[3] = pts[np.argmax(d)]   # bottom-left has largest difference
    return rect


def detect_a4_paper(img):
    """
    Detect A4 paper in the image and return a perspective-corrected (warped) top-down view.

    Returns:
        (warped_image, pixels_per_mm, confidence) or (None, None, 0) if not found.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Try multiple edge detection approaches
    warped = None
    best_contour = None
    best_area = 0
    img_area = img.shape[0] * img.shape[1]

    for canny_low, canny_high in [(30, 100), (50, 150), (75, 200)]:
        edges = cv2.Canny(blurred, canny_low, canny_high)
        # Dilate to close gaps in edges
        kernel = np.ones((3, 3), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            area = cv2.contourArea(contour)
            if area < img_area * 0.05:  # too small
                continue

            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

            if len(approx) == 4 and area > best_area:
                best_contour = approx
                best_area = area

    if best_contour is None:
        # Fallback: try adaptive threshold for white paper detection
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, 11, 2)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            area = cv2.contourArea(contour)
            if area < img_area * 0.05:
                continue
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
            if len(approx) == 4 and area > best_area:
                best_contour = approx
                best_area = area

    if best_contour is None:
        return None, None, 0.0

    # Order the 4 corner points
    pts = best_contour.reshape(4, 2).astype("float32")
    ordered = order_points(pts)

    # Determine if the paper is portrait or landscape based on detected aspect ratio
    width_top = np.linalg.norm(ordered[1] - ordered[0])
    height_left = np.linalg.norm(ordered[3] - ordered[0])

    if width_top > height_left:
        # Paper is landscape — swap destination dimensions
        dst_w, dst_h = WARP_HEIGHT, WARP_WIDTH
    else:
        dst_w, dst_h = WARP_WIDTH, WARP_HEIGHT

    dst = np.array([
        [0, 0],
        [dst_w - 1, 0],
        [dst_w - 1, dst_h - 1],
        [0, dst_h - 1]
    ], dtype="float32")

    matrix = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(img, matrix, (dst_w, dst_h))

    pixels_per_mm = WARP_SCALE  # by construction

    # Confidence based on how rectangular and how large the detection is
    area_ratio = best_area / img_area
    confidence = min(1.0, area_ratio * 3)  # good if paper is >33% of image

    return warped, pixels_per_mm, confidence


def detect_foot(warped):
    """
    Detect foot on the warped (top-down) A4 paper image.

    Uses non-white region detection: on white paper, the foot is the largest dark region.

    Returns:
        (foot_contour, confidence) or (None, 0) if not found.
    """
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    # Method 1: Detect non-white regions (foot on white paper)
    # Threshold to find dark regions on white paper
    _, thresh = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)

    # Clean up noise
    kernel = np.ones((5, 5), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        # Method 2: Try HSV skin detection as fallback
        return _detect_foot_hsv(warped)

    # Find the largest contour that looks like a foot
    best_contour = None
    best_score = 0
    paper_area = warped.shape[0] * warped.shape[1]

    for contour in contours:
        area = cv2.contourArea(contour)
        area_ratio = area / paper_area

        # Foot should be between 5% and 55% of A4 paper area
        if area_ratio < 0.05 or area_ratio > 0.55:
            continue

        # Check aspect ratio of bounding rect
        rect = cv2.minAreaRect(contour)
        w, h = rect[1]
        if w == 0 or h == 0:
            continue
        aspect = max(w, h) / min(w, h)

        # Foot aspect ratio is typically between 2.0 and 4.0
        if aspect < 1.5 or aspect > 5.0:
            continue

        score = area_ratio
        if score > best_score:
            best_score = score
            best_contour = contour

    if best_contour is None:
        return _detect_foot_hsv(warped)

    confidence = min(1.0, best_score * 4)
    return best_contour, confidence


def _detect_foot_hsv(warped):
    """Fallback: detect foot using HSV skin color detection."""
    hsv = cv2.cvtColor(warped, cv2.COLOR_BGR2HSV)

    # Broad skin color range
    lower_skin = np.array([0, 20, 50], dtype=np.uint8)
    upper_skin = np.array([35, 180, 255], dtype=np.uint8)

    mask = cv2.inRange(hsv, lower_skin, upper_skin)

    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None, 0.0

    paper_area = warped.shape[0] * warped.shape[1]
    best_contour = None
    best_area = 0

    for contour in contours:
        area = cv2.contourArea(contour)
        area_ratio = area / paper_area
        if 0.05 < area_ratio < 0.55 and area > best_area:
            best_area = area
            best_contour = contour

    if best_contour is None:
        return None, 0.0

    confidence = min(1.0, (best_area / paper_area) * 3) * 0.7  # lower confidence for HSV
    return best_contour, confidence
