import json
import os
from app.models.schemas import SizeRecommendation

_charts = None


def _load_charts():
    global _charts
    if _charts is None:
        path = os.path.join(os.path.dirname(__file__), "..", "data", "size_charts.json")
        with open(path) as f:
            _charts = json.load(f)
    return _charts


def get_recommendations(length_mm: float, width_mm: float | None = None,
                        brand: str | None = None, model: str | None = None) -> list[SizeRecommendation]:
    charts = _load_charts()
    results = []

    # Determine which brand/model charts to search
    if brand and brand in charts["brands"]:
        brands_to_check = {brand: charts["brands"][brand]}
    else:
        brands_to_check = charts["brands"]

    for brand_key, brand_data in brands_to_check.items():
        models_to_check = brand_data["models"]
        if model and model in models_to_check:
            models_to_check = {model: models_to_check[model]}

        for model_key, model_data in models_to_check.items():
            sizes = model_data["sizes"]
            matched = None
            alternative = None

            for i, size in enumerate(sizes):
                if size["foot_length_min_mm"] <= length_mm <= size["foot_length_max_mm"]:
                    matched = size
                    # Next size up as alternative
                    if i + 1 < len(sizes):
                        alternative = sizes[i + 1]
                    break

            # If no exact match, find the closest (prefer sizing up)
            if matched is None:
                for i, size in enumerate(sizes):
                    if length_mm < size["foot_length_min_mm"]:
                        matched = size
                        if i + 1 < len(sizes):
                            alternative = sizes[i + 1]
                        break
                # If still no match, foot is larger than all sizes
                if matched is None and sizes:
                    matched = sizes[-1]

            if matched is None:
                continue

            # Determine width category
            width_category = "standard"
            note = None
            if width_mm and "width_standard_max_mm" in matched:
                if width_mm > matched["width_standard_max_mm"]:
                    width_category = "wide"
                    note = "Your foot is wider than average. Consider sizing up or choosing a wide-fit model."
                elif width_mm < matched["width_standard_max_mm"] - 15:
                    width_category = "narrow"

            results.append(SizeRecommendation(
                brand=brand_data["name"],
                model=model_data["name"],
                recommended_size=matched["label"],
                eu_size=matched.get("eu"),
                us_size=matched.get("us_m"),
                uk_size=matched.get("uk"),
                width_category=width_category,
                alternative_size=alternative["label"] if alternative else None,
                note=note,
            ))

    return results
