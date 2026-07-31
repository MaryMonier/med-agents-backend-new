FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Railway بيحدد البورت عن طريق متغير PORT تلقائيًا - بنستخدمه بدل ما نثبّت
# 8001 يدويًا، عشان يتوافق مع أي بورت Railway هيديهولنا
ENV PORT=8001
EXPOSE $PORT

CMD uvicorn app:app --host 0.0.0.0 --port $PORT
