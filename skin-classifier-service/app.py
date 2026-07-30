"""
خدمة صغيرة مستقلة (FastAPI) بتشغّل موديل تصنيف صور الأمراض الجلدية محليًا
(Inference بس - مفيش تدريب هنا). الباك اند بتاع Node بيناديها عن طريق HTTP
داخليًا (نفس السيرفر أو نفس الشبكة الداخلية) - مش API خارجي، فمفيش أي
اعتماد على حد تاني ممكن يوقف أو "ينام".

الموديل بيتحمّل مرة واحدة بس وقت startup ويفضل في الـ RAM، مش بيتحمّل من
جديد مع كل request - عشان الاستجابة تبقى سريعة.
"""

import io
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
import base64

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("skin-classifier")

# اسم الموديل - ViT اتعمله fine-tune على صور DermNet (23 فئة من أمراض
# الجلد المختلفة، مش سرطان الجلد بس). ممكن تغيّره لاحقًا لموديل تاني لو
# لقيت واحد أدق، من غير ما تغيّر أي حاجة تانية في الكود.
MODEL_NAME = "WahajRaza/finetuned-dermnet"

app = FastAPI(title="Skin Disease Classifier Service")

processor = None
model = None


@app.on_event("startup")
def load_model():
    global processor, model
    logger.info(f"Loading model {MODEL_NAME} ...")
    processor = AutoImageProcessor.from_pretrained(MODEL_NAME)
    model = AutoModelForImageClassification.from_pretrained(MODEL_NAME)
    model.eval()
    logger.info("Model loaded and ready.")


class ClassifyRequest(BaseModel):
    # صورة واحدة كـ base64 (من غير data:image/...;base64, prefix)
    imageBase64: str
    # عدد أعلى النتائج المطلوب رجوعها
    topK: int = 3


class Prediction(BaseModel):
    label: str
    score: float


class ClassifyResponse(BaseModel):
    predictions: list[Prediction]


@app.get("/health")
def health():
    return {"status": "ok", "modelLoaded": model is not None}


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    try:
        image_bytes = base64.b64decode(req.imageBase64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data")

    inputs = processor(images=image, return_tensors="pt")

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]

    top_k = max(1, min(req.topK, probs.shape[0]))
    top_probs, top_indices = torch.topk(probs, top_k)

    predictions = [
        Prediction(
            label=model.config.id2label[idx.item()],
            score=round(prob.item(), 4),
        )
        for prob, idx in zip(top_probs, top_indices)
    ]

    return ClassifyResponse(predictions=predictions)
