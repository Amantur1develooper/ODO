#!/usr/bin/env bash
# Управление ОДО: ./odo.sh start | stop | restart | status | logs | backup | restore <папка> | update
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { cp .env.example .env; echo "Создан .env из .env.example — поменяйте пароли!"; }
PORT=$(grep -E '^HTTP_PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}

addresses() {
  echo "  На этом компьютере:   http://localhost:$PORT"
  local ip
  ip=$( (ipconfig getifaddr en0 || ipconfig getifaddr en1 || hostname -I | awk '{print $1}') 2>/dev/null || true)
  [ -n "$ip" ] && echo "  С других устройств:   http://$ip:$PORT   (в той же сети Wi-Fi)"
}

case "${1:-}" in
  start)
    docker compose up -d --build
    echo; echo "ОДО запущен:"; addresses ;;
  stop)
    docker compose stop; echo "ОДО остановлен. Данные сохранены в ./data" ;;
  restart)
    docker compose restart; addresses ;;
  status)
    docker compose ps; echo; addresses ;;
  logs)
    docker compose logs -f --tail 100 "${@:2}" ;;
  backup)
    ./scripts/backup.sh ;;
  restore)
    ./scripts/restore.sh "${2:?Укажите папку резервной копии, например backups/odo-20261008-120000}" ;;
  update)
    docker compose up -d --build; echo "Обновлено."; addresses ;;
  *)
    echo "Использование: ./odo.sh start | stop | restart | status | logs | backup | restore <папка> | update"; exit 1 ;;
esac
