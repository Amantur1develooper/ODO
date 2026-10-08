#!/usr/bin/env bash
# Резервная копия ОДО: база данных + все файлы.  Использование: ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/odo-$STAMP"
mkdir -p "$OUT"

echo "→ База данных…"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-odo}" -d "${POSTGRES_DB:-odo}" -Fc > "$OUT/db.dump"

echo "→ Файлы (может занять время)…"
# Без сжатия: видео и документы уже сжаты, а так в разы быстрее.
tar -C data -cf "$OUT/files.tar" files

cp .env "$OUT/env.backup"
echo "Готово: $OUT ($(du -sh "$OUT" | cut -f1))"
