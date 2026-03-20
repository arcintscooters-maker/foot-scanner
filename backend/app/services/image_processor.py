import anthropic
import base64
import json
import re

from app.config import settings

# Standard credit card dimensions (ISO/IEC 7810 ID-1)
CARD_WIDTH_MM = 85.6
CARD_HEIGHT_MM = 53.98

VISION_PROMPT = """You are a foot measurement tool. Analyze this photo which shows a person's bare foot placed on the floor next to a standard credit/debit card (85.6mm × 53.98mm).

Your job:
1. Identify the credit/debit card in the image
2. Identify the bare foot in the image
3. Using the card as a size reference, estimate the foot's length (heel to longest toe) and width (widest point across the ball of the foot) in millimeters

Important measurement guidelines:
- The card's long edge is 85.6mm and short edge is 53.98mm
- Estimate how many card-lengths the foot is, then multiply
- Foot length is measured from the very back of the heel to the tip of the longest toe
- Foot width is the widest horizontal distance across the ball of the foot
- Be as precise as possible — even 5mm matters for shoe sizing
- Adult foot lengths typically range from 220mm to 310mm
- Adult foot widths typically range from 80mm to 115mm

You MUST respond with ONLY a JSON object in this exact format, no other text:
{"foot_length_mm": <number>, "foot_width_mm": <number>, "confidence": <number between 0 and 1>, "notes": "<brief observation about the measurement>"}

If you cannot detect a credit card, respond with:
{"error": "CARD_NOT_DETECTED", "message": "<reason>"}

If you cannot detect a foot, respond with:
{"error": "FOOT_NOT_DETECTED", "message": "<reason>"}"""


def analyze_foot_image(image_bytes: bytes, media_type: str = "image/jpeg") -> dict:
    """
    Send foot image to Claude Vision for measurement.

    Returns dict with either measurements or error info.
    """
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": VISION_PROMPT,
                    },
                ],
            }
        ],
    )

    response_text = message.content[0].text.strip()

    # Extract JSON from response (handle markdown code blocks)
    json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())

    raise ValueError(f"Could not parse response: {response_text}")
