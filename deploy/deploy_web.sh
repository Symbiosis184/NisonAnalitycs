#!/usr/bin/env bash
# Kairi Analytics — деплой фронтенда без npm/rsync (статика из коммита dist/ в main).
# Использование (root на боевом сервере):
#   curl -fsSL https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/deploy/deploy_web.sh | bash
set -euo pipefail

WEB_DIR="${WEB_DIR:-/var/www/kairi}"
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
cp -a "$REPO_DIR/dist/." "$WEB_DIR/"
chmod -R a+rX "$WEB_DIR"

echo "==> Проверка:"
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$WEB_DIR/index.html"
echo "OK: фронтенд обновлён. Сделайте Ctrl+Shift+R в браузере."
