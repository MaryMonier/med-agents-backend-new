@echo off
REM سكريبت تشغيل سريع - دبل كليك عليه أو شغّله من الترمينال بدل ما تكتب
REM الأوامر يدويًا كل مرة. لازم يكون موجود جوه فولدر skin-classifier-service
REM نفسه (نفس مكان app.py و venv).

cd /d "%~dp0"
call venv\Scripts\activate.bat
uvicorn app:app --host 0.0.0.0 --port 8001
