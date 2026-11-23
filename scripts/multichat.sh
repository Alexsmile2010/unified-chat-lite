#!/bin/bash
# Мультичат без Docker: запуск, зупинка, статус.
#   scripts/multichat.sh start   — піднімає сервер у фоні; вікно Terminal можна закривати
#   scripts/multichat.sh stop    — зупиняє сервер
#   scripts/multichat.sh status  — перевіряє, чи відповідає сервер
#
# Сервер запускається через nohup, тож закриття вікна Terminal його не зупиняє.
# MULTICHAT_HOST: 0.0.0.0 (типово, як було в Docker — чат доступний і з телефону
# у тій самій мережі); 127.0.0.1 — лише з цього Mac.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MULTICHAT_PORT:-8100}"
HOST="${MULTICHAT_HOST:-0.0.0.0}"
BASE="http://localhost:$PORT"
VENV="$ROOT/.venv"
REQ="$ROOT/server/requirements.txt"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/multichat.pid"
LOG_FILE="$LOG_DIR/multichat.log"
STAMP="$VENV/requirements.sha256"

die() { echo "✗ $*" >&2; exit 1; }

healthy() { curl -fs --max-time 2 "$BASE/health" >/dev/null 2>&1; }

ensure_venv() {
  local want
  want="$(shasum -a 256 "$REQ" | cut -d' ' -f1)" || die "Не можу прочитати $REQ"
  if [[ ! -x "$VENV/bin/python" ]]; then
    echo "Створюю середовище Python (перший запуск, може тривати кілька хвилин)…"
    python3 -m venv "$VENV" || die "Не вдалося створити середовище. Потрібен Python 3.11+ (перевір: python3 --version)."
  fi
  if [[ "$(cat "$STAMP" 2>/dev/null)" != "$want" ]]; then
    echo "Встановлюю залежності…"
    "$VENV/bin/python" -m pip install --quiet -r "$REQ" || die "pip не зміг встановити залежності."
    echo "$want" > "$STAMP"
  fi
}

start() {
  mkdir -p "$LOG_DIR"
  if healthy; then
    echo "✓ Мультичат уже працює: $BASE"
    return 0
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "Порт $PORT зайнятий іншим процесом (можливо, ще працює Docker-контейнер). Перевір: lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  fi
  ensure_venv
  cd "$ROOT" || die "Не вдалося перейти в $ROOT"
  nohup "$VENV/bin/python" -m uvicorn server.main:app \
    --host "$HOST" --port "$PORT" \
    --no-access-log --log-level warning --ws-per-message-deflate false \
    >>"$LOG_FILE" 2>&1 </dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null
  echo "$pid" > "$PID_FILE"
  echo "Запускаю мультичат…"
  for _ in $(seq 1 30); do
    if healthy; then
      echo "✓ Працює: $BASE (PID $pid)"
      echo "  Вікно Terminal можна закривати — сервер продовжить роботу."
      echo "  Зупинити: $ROOT/scripts/multichat.sh stop"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || die "Сервер завершився одразу. Лог: $LOG_FILE"
    sleep 1
  done
  die "Сервер не відповів за 30 с. Лог: $LOG_FILE"
}

stop() {
  local pid=""
  [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 1 )) && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid"; fi
    echo "✓ Мультичат зупинено (PID $pid)."
  else
    echo "Мультичат, запущений цим скриптом, не знайдено."
  fi
  rm -f "$PID_FILE"
}

status() {
  if healthy; then
    echo "✓ Працює: $BASE"
  else
    echo "✗ Не працює"
    return 1
  fi
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "Використання: $0 start | stop | status" >&2; exit 2 ;;
esac
