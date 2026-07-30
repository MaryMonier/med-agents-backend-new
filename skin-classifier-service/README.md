# Skin Disease Classifier Service

خدمة مستقلة صغيرة (Python/FastAPI) بتشغّل موديل تصنيف صور الأمراض الجلدية
محليًا. الباك اند بتاع Node بينادي عليها داخليًا عبر HTTP.

## التشغيل محليًا (مرة واحدة أول تشغيل هتاخد وقت أطول لتحميل الموديل)

```bash
cd skin-classifier-service
python3 -m venv venv
source venv/bin/activate        # على ويندوز: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

أول مرة هيحمّل أوزان الموديل من Hugging Face تلقائيًا (~300-400MB) ويخزّنها
في `~/.cache/huggingface` - المرات الجاية هتكون من الكاش المحلي، من غير
إنترنت حتى.

## اختبار سريع

```bash
curl http://localhost:8001/health
```

## التشغيل بشكل دائم (production)

استخدم `pm2` أو `systemd` أو Docker عشان الخدمة تفضل شغالة وتشتغل تلقائي مع
أي ريستارت للسيرفر، بنفس الطريقة اللي الباك اند بتاع Node شغال بيها.

مثال Dockerfile بسيط لو محتاجه:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
```

## ملحوظة عن env var

الباك اند بتاع Node محتاج يعرف عنوان الخدمة دي عن طريق:

```
SKIN_CLASSIFIER_URL=http://localhost:8001
```

لو الخدمة شغالة على سيرفر تاني أو Docker container تاني، غيّر القيمة دي
بس - مفيش أي كود تاني محتاج تعديل.
