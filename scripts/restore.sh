#!/usr/bin/env bash
# Восстановление из копии на этом или новом сервере.
# Использование: ./scripts/restore.sh backups/odo-YYYYMMDD-HHMMSS
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?Укажите папку с резервной копией}"
[ -f .env ] || cp "$SRC/env.backup" .env
set -a; . ./.env; set +a

echo "→ Останавливаю приложение…"
docker compose stop web backend worker 2>/dev/null || true
docker compose up -d db
until docker compose exec -T db pg_isready -U "${POSTGRES_USER:-odo}" >/dev/null 2>&1; do sleep 1; done

echo "→ База данных…"
docker compose exec -T db pg_restore -U "${POSTGRES_USER:-odo}" -d "${POSTGRES_DB:-odo}" --clean --if-exists --no-owner < "$SRC/db.dump"

echo "→ Файлы…"
mkdir -p data
rm -rf data/files
tar -C data -xf "$SRC/files.tar"

docker compose up -d --build
echo "Готово."
