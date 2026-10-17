#!/usr/bin/env bash
# NisonAnalytics — установка дашборда на VPS (Debian/Ubuntu, nginx, без IPv6)
# Использование (на сервере под root):
#   curl -fsSL https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/deploy/vps_setup.sh | bash
set -euo pipefail

REPO="https://github.com/Symbiosis184/NisonAnalitycs.git"
WEB_ROOT="/var/www/nison-analytics"
BUILD_DIR="/opt/nison-build"

echo "==> 1/6 Установка пакетов (nginx, git, curl)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl ca-certificates gnupg || {
    echo "Установка прервалась — донастраиваем dpkg и повторяем";
    dpkg --configure -a; apt-get install -y -qq nginx git curl ca-certificates gnupg; }

echo "==> 2/6 Node.js 22 LTS (нужен для сборки фронтенда)"
if ! command -v npm >/dev/null 2>&1; then
    if [ ! -f /etc/apt/sources.list.d/nodesource.list ]; then
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
            | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
            > /etc/apt/sources.list.d/nodesource.list
    fi
    apt-get update -qq
    apt-get install -y -qq nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> 3/6 Фикс IPv6 в типовом конфиге nginx (если IPv6 не поддерживается)"
if ! ip -6 addr show lo >/dev/null 2>&1 || [ ! -e /proc/net/if_inet6 ]; then
    sed -ri 's/^(\s*)listen\s+\[::\]:80.*;/\1# disabled (no IPv6): &/' /etc/nginx/sites-available/default 2>/dev/null || true
fi
dpkg --configure -a 2>/dev/null || true

echo "==> 4/6 Сборка фронтенда из GitHub (main)"
rm -rf "$BUILD_DIR"
git clone --depth 50 "$REPO" -b main "$BUILD_DIR"
cd "$BUILD_DIR"
npm ci --silent --no-audit --no-fund
npm run build

echo "==> 5/6 Публикация статики в $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/"*
cp -r dist/* "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT" && chmod -R a+rX "$WEB_ROOT"

echo "==> 6/6 Конфиг сайта nginx + запуск"
cat > /etc/nginx/sites-available/nison <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    root /var/www/nison-analytics;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.bybit.com wss://stream.binance.com:9443 https://stream.binance.com; img-src 'self' data:; font-src 'self' data:;" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
EOF
ln -sf /etc/nginx/sites-available/nison /etc/nginx/sites-enabled/nison
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx 2>/dev/null || service nginx start
systemctl reload nginx 2>/dev/null || nginx -s reload

# фаервол (если ufw активен)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null || true
fi

rm -rf "$BUILD_DIR"
echo ""
echo "✅ Готово. Откройте в браузере: http://$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || echo '<IP сервера>')"
echo "   Если снаружи не открывается — проверьте порты 80/443 в панели хостинга (security group)."
