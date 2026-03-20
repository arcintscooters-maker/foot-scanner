from pydantic import BaseModel


class ScanResult(BaseModel):
    foot_length_mm: float
    foot_width_mm: float
    foot_length_cm: float
    foot_width_cm: float
    confidence: float
    error: str | None = None
    error_code: str | None = None


class SizeRecommendation(BaseModel):
    brand: str
    model: str
    recommended_size: str
    eu_size: int | None = None
    us_size: float | None = None
    uk_size: float | None = None
    width_category: str  # narrow, standard, wide
    alternative_size: str | None = None
    note: str | None = None


class RecommendResponse(BaseModel):
    foot_length_mm: float
    foot_width_mm: float
    recommendations: list[SizeRecommendation]


class ScanResponse(BaseModel):
    scan: ScanResult
    recommendations: list[SizeRecommendation]


class ErrorResponse(BaseModel):
    error: str
    error_code: str
    tips: list[str] = []
