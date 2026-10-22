#!/usr/bin/env bash
# Kairi Analytics — установка дашборда на VPS (Debian/Ubuntu, nginx, без IPv6)
# Домен: kairi.pro (нужны A-записи kairi.pro и www.kairi.pro -> IP сервера)
# Использование (на сервере под root):
#   curl -fsSL https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/deploy/vps_setup.sh | bash
set -euo pipefail

REPO="https://github.com/Symbiosis184/NisonAnalitycs.git"
WEB_ROOT="/var/www/nison-analytics"
BUILD_DIR="/opt/nison-build"
DOMAIN="kairi.pro"
WWW_DOMAIN="www.kairi.pro"

echo "==> 1/8 Установка пакетов (nginx, git, curl, certbot)"
# v2: bootstrap-fix (certbot webroot, self-signed до выпуска LE)
export DEPLOY_SCRIPT_REV="v2"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx || {
    echo "Установка прервалась — донастраиваем dpkg и повторяем";
    dpkg --configure -a; apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx; }

echo "==> 2/8 Node.js 22 LTS (нужен для сборки фронтенда)"
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

echo "==> 3/8 Фикс IPv6 в типовом конфиге nginx (если IPv6 не поддерживается)"
if [ ! -e /proc/net/if_inet6 ]; then
    sed -ri 's/^(\s*)listen\s+\[::\]:80.*/\1# disabled (no IPv6): &/' /etc/nginx/sites-available/default /etc/nginx/conf.d/*.conf 2>/dev/null || true
fi
dpkg --configure -a 2>/dev/null || true

echo "==> 4/8 Сборка фронтенда из GitHub (main)"
rm -rf "$BUILD_DIR"
git clone --depth 50 "$REPO" -b main "$BUILD_DIR"
cd "$BUILD_DIR"
npm ci --silent --no-audit --no-fund
npm run build

echo "==> 5/8 Публикация статики в $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/"*
cp -r dist/* "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT" && chmod -R a+rX "$WEB_ROOT"

echo "==> 6/8 Настройка nginx (домен $DOMAIN) + запуск"
write_nginx_conf() {
    local with_ssl="$1"   # yes|no
    local ssl_block="" redirect_block=""
    if [ "$with_ssl" = "yes" ]; then
        ssl_block="
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;"
    else
        # самоподписанный временный сертификат — нужен, чтобы nginx вообще
        # смог запуститься с listen 443 до выпуска сертификата Let's Encrypt
        mkdir -p /etc/nginx/ssl
        if [ ! -f /etc/nginx/ssl/kairi-selfsigned.pem ]; then
            openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
                -keyout /etc/nginx/ssl/kairi-selfsigned.key \
                -out /etc/nginx/ssl/kairi-selfsigned.pem \
                -subj "/CN=$DOMAIN" 2>/dev/null || true
        fi
        ssl_block="
    ssl_certificate     /etc/nginx/ssl/kairi-selfsigned.pem;
    ssl_certificate_key /etc/nginx/ssl/kairi-selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;"
    fi
    cat > /etc/nginx/sites-available/kairi <<EOF
# HTTP: ACME-челленджи + (при наличии сертификата) редирект на HTTPS
server {
    listen 80 default_server;
    server_name $DOMAIN www.$DOMAIN _;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
$( [ "$with_ssl" = "yes" ] && echo '
    location / {
        return 301 https://$host$request_uri;
    }' || echo '
    # сертификат ещё не выпущен — отдаём сайт по HTTP напрямую
    root /var/www/nison-analytics;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }' )
}

# HTTPS: основное приложение
server {
    listen 443 ssl default_server;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;$ssl_block

    root /var/www/nison-analytics;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # index.html не кешируем: иначе браузер показывает старый билд
    # со ссылками на устаревшие чанки (белый экран после деплоя)
    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.bybit.com wss://stream.bybit.com wss://stream.binance.com:9443 https://stream.binance.com; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; upgrade-insecure-requests;" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
EOF
    ln -sf /etc/nginx/sites-available/kairi /etc/nginx/sites-enabled/kairi
    rm -f /etc/nginx/sites-enabled/nison /etc/nginx/sites-enabled/default
    mkdir -p /var/www/html
}

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ -f "$CERT_DIR/fullchain.pem" ]; then
    write_nginx_conf yes
else
    echo "    Сертификата ещё нет — ставим временный самоподписанный (чтобы nginx запустился до шага с certbot)"
    write_nginx_conf no
fi
nginx -t
systemctl enable --now nginx 2>/dev/null || service nginx start
systemctl reload nginx 2>/dev/null || nginx -s reload

# фаервол (если ufw активен)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null || true
fi

echo "==> 7/8 SSL-сертификат Let's Encrypt для $DOMAIN"
ISSUED=""
for host in "$DOMAIN" "$WWW_DOMAIN"; do
    if certbot certonly --webroot -w /var/www/html -d "$host" \
        --non-interactive --agree-tos -m "admin@$DOMAIN" --keep-until-expiring 2>&1 \
        || certbot certonly --webroot -w /var/www/html -d "$host" \
            --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring 2>&1; then
        ISSUED="yes"
        echo "    Сертификат выпущен/обновлён для $host"
    else
        echo "    !! Не удалось получить сертификат для $host"
        echo "       Проверьте A-запись $host -> IP сервера (dig +short $host)."
    fi
done
if [ -n "$ISSUED" ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    # переписываем конфиг уже с настоящими сертификатами и редиректом HTTP->HTTPS
    write_nginx_conf yes
    nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload)
fi
[ -z "$ISSUED" ] && echo "    WARNING: ни один хост не получил сертификат — сайт будет доступен только по http://"
systemctl reload nginx 2>/dev/null || nginx -s reload || true

echo "==> 8/8 Автопродление сертификатов (certbot renew)"
mkdir -p /etc/cron.d
cat > /etc/cron.d/kairi-certbot-renew <<'EOF'
0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx || nginx -s reload"
EOF
chmod 0644 /etc/cron.d/kairi-certbot-renew

rm -rf "$BUILD_DIR"
echo ""
echo "✅ Готово."
if [ -n "$ISSUED" ]; then
    echo "   Откройте в браузере: https://$DOMAIN"
else
    echo "   Откройте в браузере: http://$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || echo '<IP сервера>') (HTTPS недоступен — см. предупреждение выше)"
fi
echo "   Если снаружи не открывается — проверьте порты 80/443 в панели хостинга (security group)."
