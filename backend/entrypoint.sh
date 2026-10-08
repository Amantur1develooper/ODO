#!/bin/sh
set -e
python manage.py migrate --noinput
python manage.py ensure_admin
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --worker-class gthread \
  --workers "${GUNICORN_WORKERS:-3}" \
  --threads 8 \
  --timeout 600 \
  --access-logfile - 
