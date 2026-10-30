#!/usr/bin/env bash
# Kairi Analytics — обновление и перезапуск котировочного сервиса kairi-api
# (FastAPI quotes-proxy: Bybit + Twelvedata / американские акции).
#
# Использование (на боевом сервере под root):
#   curl -fsSL https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/deploy/restart_kairi_api.sh | bash
# или, если репозиторий уже клонирован:
#   bash deploy/restart_kairi_api.sh
#
# Что делает:
#   1) скачивает актуальные server/*.py из main (тот же источник, что vps_setup.sh);
#   2) проверяет компиляцию python (py_compile) ДО перезапуска — сломанный код
#      не уронит живой сервис;
#   3) systemctl restart kairi-api + ждёт healthz (:8000/api/quotes/healthz);
#   4) при успехе печатает версию TradFi-эндпоинта; при отказе — откат на
#      предыдущую копию файлов и повторный рестарт.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main"
APP_DIR="/opt/kairi-api"
BACKUP_DIR="/opt/kairi-api/.backup-prev"
HEALTH_URL="http://127.0.0.1:8000/api/quotes/healthz"

echo "==> 1/4 Скачивание актуальных файлов из GitHub main"
mkdir -p "$APP_DIR" "$BACKUP_DIR"
ok_dl=1
for f in quotes_server.py journal_token.py; do
    curl -fsSL --max-time 30 "$REPO_RAW/server/$f" -o "/tmp/kairi_$f" || { echo "    !! не удалось скачать $f"; ok_dl=0; }
done
curl -fsSL --max-time 30 "$REPO_RAW/deploy/vps_setup.sh" -o /tmp/kairi_vps_setup.sh || true
curl -fsSL --max-time 30 "$REPO_RAW/deploy/inject_tokens.py" -o "$APP_DIR/inject_tokens.py" || true
chmod 644 "$APP_DIR/inject_tokens.py" 2>/dev/null || true
if [ "$ok_dl" = "0" ]; then
    echo "    Скачивание не удалось — перезапускаю сервис на текущем коде без обновления."
else
    # резервная копия текущего рабочего кода (для отката)
    for f in quotes_server.py journal_token.py; do
        [ -f "$APP_DIR/$f" ] && cp -a "$APP_DIR/$f" "$BACKUP_DIR/$f" || true
    done
    for f in quotes_server.py journal_token.py; do
        [ -f "/tmp/kairi_$f" ] && mv "/tmp/kairi_$f" "$APP_DIR/$f" || true
    done
    chmod 644 "$APP_DIR"/*.py
fi

echo "==> 1.5 Ключ Twelve Data и секреты"
mkdir -p /etc/kairi
if [ ! -s /etc/kairi/twelvedata.key ]; then
    echo "091e319b4dba4cd9a25e02f65cbe9b54" > /etc/kairi/twelvedata.key
    chmod 600 /etc/kairi/twelvedata.key
    echo "    создан /etc/kairi/twelvedata.key (из vps_setup.sh)"
else
    echo "    /etc/kairi/twelvedata.key уже существует — не трогаю"
fi
# X-Kairi-Key (HMAC-секрет доступа к прокси): если ещё нет — сгенерировать через vps_setup.sh
SECRET_LINE=$(grep -h '^KAIRI_SECRET=' /opt/kairi-api/.env /etc/kairi/env 2>/dev/null | head -1 || true)
if [ -z "$SECRET_LINE" ] && [ -f /tmp/kairi_vps_setup.sh ]; then
    echo "    KAIRI_SECRET не найден в .env — запускаю vps_setup.sh для генерации секретов..."
    bash /tmp/kairi_vps_setup.sh || echo "    !! vps_setup.sh завершился с ошибкой — проверьте вручную"
fi
rm -f /tmp/kairi_vps_setup.sh

echo "==> 2/4 Проверка синтаксиса python до рестарта"
PY="$APP_DIR/venv/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"
if ! "$PY" -m py_compile "$APP_DIR/quotes_server.py"; then
    echo "    !! quotes_server.py не компилируется — откатываю резервную копию"
    for f in quotes_server.py journal_token.py; do
        [ -f "$BACKUP_DIR/$f" ] && cp -a "$BACKUP_DIR/$f" "$APP_DIR/$f" || true
    done
fi

echo "==> 3/4 Перезапуск сервиса kairi-api"
systemctl reset-failed kairi-api >/dev/null 2>&1 || true
systemctl restart kairi-api

echo "==> 4/4 Ожидание healthz (до 20 с; uvicorn+apscheduler стартуют 3-10 с)"
UP=""
for i in $(seq 1 20); do
    if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then UP="yes"; break; fi
    sleep 1
done
if [ -n "$UP" ]; then
    echo "    OK: Commerce API работает (127.0.0.1:8000)"
    # быстрая самопроверка TradFi-ветки (Twelvedata): 200/401/429/503 => обработчик жив
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
        "http://127.0.0.1:8000/api/quotes/klines?symbol=AAPL:STOCK&interval=d&limit=5&exchange=twelvedata" || echo "000")
    case "$code" in
        200|401|429) echo "    OK: TradFi-эндпоинт отвечает (HTTP $code; 401 = нужен X-Kairi-Key — норма для curl)" ;;
        503) echo "    !! TradFi вернул 503: на сервере не задан ключ Twelvedata."
           echo "       Исправьте: echo ВАШ_КЛЮЧ > /etc/kairi/twelvedata.key && chmod 600 /etc/kairi/twelvedata.key && systemctl restart kairi-api" ;;
        *) echo "    ВНИМАНИЕ: TradFi-эндпоинт вернул HTTP $code — смотрите journalctl -u kairi-api -n 20" ;;
    esac
    # Инъекция свежих браузерных токенов в index.html: старый JSON-формат
    # ("{"exp":...}") ломал HTML-атрибут content="..." (деплой обрезал токен,
    # браузер присылал мусор -> 403 invalid or expired token). Новый формат —
    # base64url без кавычек; скрипт идемпотентен и сам определяет WEB_DIR.
    if [ -f "$APP_DIR/journal_token.py" ]; then
        INJ="$APP_DIR/inject_tokens.py"
        curl -fsSL --max-time 30 "$REPO_RAW/deploy/inject_tokens.py" -o /tmp/kairi_inject.py \
            && mv /tmp/kairi_inject.py "$INJ" && chmod 644 "$INJ" || true
        [ -f "$INJ" ] || INJ="/opt/nison-build/deploy/inject_tokens.py"
        if [ -f "$INJ" ]; then
            "$PY" "$INJ" 2>&1 | sed 's/^/      /' || echo "    !! инъекция токенов не выполнена — проверьте inject_tokens.py вручную"
        else
            echo "    !! inject_tokens.py не найден — пропуск токенов (акции могут отдавать 403 до следующего vps_setup.sh)"
        fi
    fi
    echo "    Готово. Активная ревизия:"
    git -C /opt/nison-build log --oneline -1 2>/dev/null | sed 's/^/      /' || true
    systemctl is-active kairi-api kairi-journal nginx | sed 's/^/      /'
else
    echo "    !! Сервис не поднялся. Диагностика и откат:"
    systemctl status kairi-api --no-pager -l 2>/dev/null | head -n 6 | sed 's/^/      /' || true
    journalctl -u kairi-api --no-pager -n 20 2>/dev/null | sed 's/^/      /' || true
    if compgen -G "$BACKUP_DIR/*.py" >/dev/null; then
        echo "    Откатываю предыдущую рабочую версию файлов и повторяю рестарт..."
        for f in quotes_server.py journal_token.py; do
            [ -f "$BACKUP_DIR/$f" ] && cp -a "$BACKUP_DIR/$f" "$APP_DIR/$f" || true
        done
        systemctl restart kairi-api
        sleep 5
        curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1 \
            && echo "    Откат успешен: сервис снова работает (но БЕЗ новых изменений)" \
            || echo "    !! И после отката не отвечает — разбирайтесь вручную: systemctl status kairi-api"
    fi
    exit 1
fi
