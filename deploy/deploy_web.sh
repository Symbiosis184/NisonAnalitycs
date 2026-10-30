#!/usr/bin/env bash
# Kairi Analytics — деплой фронтенда без npm/rsync (статика из коммита dist/ в main).
# Использование (root на боевом сервере):
#   curl -fsSL https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/deploy/deploy_web.sh | bash
set -euo pipefail

# Автоопределение веб-директории: явный WEB_DIR > nginx root > известный путь.
if [ -z "${WEB_DIR:-}" ]; then
    NGINX_ROOT=$(grep -rhoP '^\s*root\s+\K[^;]+' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -1 || true)
    if [ -n "$NGINX_ROOT" ]; then WEB_DIR="$NGINX_ROOT"; else WEB_DIR="/var/www/nison-analytics"; fi
fi
REPO_DIR=/opt/nison-build

echo "==> Обновление репозитория (нужен dist/ из main)"
if [ ! -d "$REPO_DIR/.git" ]; then
    git clone --depth 5 https://github.com/Symbiosis184/NisonAnalitycs.git "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --depth 5 origin main
git -C "$REPO_DIR" reset --hard origin/main

if [ ! -f "$REPO_DIR/dist/index.html" ]; then
    echo "!! dist/index.html отсутствует в клоне — что-то пошло не так"; exit 1
fi

echo "==> Копирование статики в $WEB_DIR"
mkdir -p "$WEB_DIR"
rm -rf "${WEB_DIR:?}/"*
cp -a "$REPO_DIR/dist/." "$WEB_DIR/"
chmod -R a+rX "$WEB_DIR"

# Токены доступа (meta kairi-api-token / kairi-journal-token) НЕ могут лежать
# в git (подписываются секретами боевого сервера). dist/index.html из репо —
# «чистый», поэтому после копирования обязательно выполняем инъекцию токенов:
# без них браузер получает 401/403 на /api/quotes/* («Не удалось получить
# данные с биржи»). Скрипт идемпотентен, TTL 12 ч.
INJ_SRC="$REPO_DIR/deploy/inject_tokens.py"
INJ_DST=/opt/kairi-api/inject_tokens.py
if [ -f "$INJ_SRC" ]; then
    cp "$INJ_SRC" "$INJ_DST"
fi
if [ -f "$INJ_DST" ]; then
    echo "==> Инъекция браузерных токенов в index.html"
    WEB_DIR="$WEB_DIR" python3 "$INJ_DST" \
      || echo "    !! не удалось встроить токены — котировки вернут 401/403; выполните сначала restart_kairi_api.sh"
else
    echo "    !! inject_tokens.py не найден — токены не встроены (403 на /api/quotes/*)"
fi
chown -R www-data:www-data "$WEB_DIR" 2>/dev/null || true

echo "==> Проверка:"
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$WEB_DIR/index.html"
if grep -q 'kairi-api-token' "$WEB_DIR/index.html"; then
    echo "OK: токен котировочного API присутствует в index.html"
else
    echo "!! ВНИМАНИЕ: meta kairi-api-token ОТСУТСТВУЕТ — страницы акций будут падать с 403"
fi
echo "OK: фронтенд обновлён. Сделайте Ctrl+Shift+R в браузере."
