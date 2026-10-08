FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg — превью и конвертация видео/аудио/изображений, poppler — текст и обложки PDF
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN SECRET_KEY=build python manage.py collectstatic --noinput >/dev/null

EXPOSE 8000
CMD ["sh", "/app/entrypoint.sh"]
