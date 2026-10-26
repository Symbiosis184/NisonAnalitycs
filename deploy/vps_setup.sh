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

echo "==> 1/11 Установка пакетов (nginx, git, curl, certbot)"
# v10: server-side signal journal (sqlite API + nginx proxy + systemd unit)
# v11: коммерческий backend — FastAPI quotes-proxy (/api/quotes/*), тарифы/
#      подписки с HMAC-подтверждением оплаты, uvicorn+venv, CSP connect-src 'self'
# v12: самодиагностика деплоя в конце скрипта (проверка, что именно этот ревизия
#      скрипта реально выполнена; защищает от «деплоя» из устаревшего кеша curl/bash)
# v13: страница /pricing на фронте — регистрация (POST /api/register), заявки на
#      подписку (pending + confirm админом), env KAIRI_PAY_TO/KAIRI_TRIAL_DAYS,
#      nginx location /api/register
export DEPLOY_SCRIPT_REV="v13"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx python3-dnspython || {
    echo "Установка прервалась — донастраиваем dpkg и повторяем";
    dpkg --configure -a; apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx python3-dnspython; }

echo "==> 2/11 Остановка docker-контейнеров, занимающих порты 80/443"
# На сервере docker-proxy держит 0.0.0.0:443 (и, возможно, 80) — nginx не может
# забиндиться. Находим контейнеры с пробросом этих портов и останавливаем их.
stop_docker_on_ports() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "    docker не установлен — проускаем"
        return 0
    fi
    local stopped=0
    # docker ps --format '{{.ID}} {{.Ports}}' -> строки вида "... 0.0.0.0:443->80/tcp ..."
    while read -r cid ports; do
        [ -z "$cid" ] && continue
        if echo "$ports" | grep -qE '0\.0\.0\.0:(80|443)->|\[::\]:(80|443)->'; then
            local name
            name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')
            echo "    Останавливаю контейнер $name ($cid), порты: $ports"
            docker stop "$cid" >/dev/null 2>&1 && stopped=$((stopped+1))
        fi
    done < <(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null)
    if [ "$stopped" -gt 0 ]; then
        echo "    Остановлено контейнеров: $stopped"
        # отключаем автоперезапуск, чтобы после ребута они не вернулись на порты
        while read -r cid ports; do
            [ -z "$cid" ] && continue
            if echo "$ports" | grep -qE '0\.0\.0\.0:(80|443)->|\[::\]:(80|443)->'; then
                docker update --restart=no "$cid" >/dev/null 2>&1 || true
            fi
        done < <(docker ps -a --format '{{.ID}} {{.Ports}}' 2>/dev/null | awk '!seen[$1]++')
    else
        echo "    Контейнеры на 80/443 не найдены"
    fi
}
stop_docker_on_ports

echo "==> 3/11 Серверное хранилище журнала сигналов (API + systemd)"
# Журнал сигналов синхронизируется с сервером (см. src/utils/journalSync.ts):
# лёгкий python3 http.server + sqlite3 без внешних зависимостей; слушает
# только 127.0.0.1:8787, наружу отдаётся через nginx location /api/journal/.
mkdir -p /opt/kairi-journal /etc/kairi
# Кладём свежую копию из клонированного репозитория (шаг 6/11), если он уже
# был выполнен в этом прогоне; иначе — скачиваем с GitHub.
for f in journal_server.py journal_token.py; do
    if [ -f "$BUILD_DIR/server/$f" ]; then
        cp "$BUILD_DIR/server/$f" "/opt/kairi-journal/$f"
    else
        curl -fsSL "https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/server/$f" \
            -o "/opt/kairi-journal/$f" || { echo "    !! не удалось скачать $f"; touch /tmp/kairi_journal_broken; }
    fi
done
chmod 644 /opt/kairi-journal/journal_server.py /opt/kairi-journal/journal_token.py
python3 -m py_compile /opt/kairi-journal/journal_server.py /opt/kairi-journal/journal_token.py \
  || { echo "    !! сервер журнала не компилируется — журнал останется локальным"; touch /tmp/kairi_journal_broken; }
# Секрет доступа к API генерируется один раз и больше не меняется
if [ ! -s /etc/kairi/journal.key ]; then
    (umask 077 && openssl rand -hex 24 > /etc/kairi/journal.key)
fi
chmod 600 /etc/kairi/journal.key
# Секрет HMAC-токенов для браузера (X-Kairi-Key): выдаёт journal_token.py,
# подставляется в index.html на шаге публикации статики. Создаётся сам при
# первом запуске; здесь только гарантируем права.
if [ ! -s /etc/kairi/journal.token_secret ]; then
    (umask 077 && openssl rand -hex 32 > /etc/kairi/journal.token_secret)
fi
chmod 600 /etc/kairi/journal.token_secret

systemctl stop kairi-journal 2>/dev/null || true
cat > /etc/systemd/system/kairi-journal.service <<UNITEOF
[Unit]
Description=Kairi Analytics - journal storage API
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/kairi-journal/journal_server.py
Restart=on-failure
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable --now kairi-journal >/dev/null 2>&1 || systemctl restart kairi-journal || true
sleep 1
curl -sf http://127.0.0.1:8787/healthz >/dev/null \
  && echo "    Journal API работает (127.0.0.1:8787)" \
  || echo "    !! Journal API не отвечает — журнал останется локальным (localStorage)"

echo "==> 3b/11 Коммерческий backend-API (FastAPI quotes-proxy + подписки, v11)"
# Котировочный прокси и тарифы/подписки (server/quotes_server.py): uvicorn в
# venv на 127.0.0.1:8000, nginx проксирует /api/quotes/, /api/plans,
# /api/subscriptions. Доступ по HMAC-токену X-Kairi-Key (journal_token.py).
# Файлы берём из GitHub main (шаг клонирования BUILD_DIR идёт позже — 6/11).
apt-get install -y -qq python3-venv python3-pip >/dev/null 2>&1 || true
if [ ! -d /opt/kairi-api/venv ]; then
    python3 -m venv /opt/kairi-api/venv || touch /tmp/kairi_api_broken
fi
if ! [ -f /tmp/kairi_api_broken ]; then
    /opt/kairi-api/venv/bin/pip install -q --disable-pip-version-check \
        fastapi 'uvicorn[standard]' httpx apscheduler \
        || { echo "    !! pip install не выполнен — котировки пойдут напрямую (CSP-legacy)"; touch /tmp/kairi_api_broken; }
fi
mkdir -p /opt/kairi-api
for f in quotes_server.py journal_token.py; do
    curl -fsSL "https://raw.githubusercontent.com/Symbiosis184/NisonAnalitycs/main/server/$f" \
        -o "/opt/kairi-api/$f" || { echo "    !! не удалось скачать $f"; touch /tmp/kairi_api_broken; }
done
chmod 644 /opt/kairi-api/*.py
if ! [ -f /tmp/kairi_api_broken ]; then
    /opt/kairi-api/venv/bin/python3 -m py_compile /opt/kairi-api/quotes_server.py \
      || { echo "    !! quotes_server.py не компилируется"; touch /tmp/kairi_api_broken; }
fi
# Секрет подтверждения платежей (on-chain watcher подписывает им факт оплаты)
if [ ! -s /etc/kairi/payment_secret ]; then
    (umask 077 && openssl rand -hex 32 > /etc/kairi/payment_secret)
fi
chmod 600 /etc/kairi/payment_secret
mkdir -p /var/lib/kairi

systemctl stop kairi-api 2>/dev/null || true
cat > /etc/systemd/system/kairi-api.service <<UNITEOF
[Unit]
Description=Kairi Analytics - commerce API (quotes proxy + subscriptions)
After=network.target

[Service]
ExecStart=/opt/kairi-api/venv/bin/python3 -m uvicorn quotes_server:app --host 127.0.0.1 --port 8000 --workers 1
WorkingDirectory=/opt/kairi-api
Environment=KAIRI_QUOTES_DB=/var/lib/kairi/commerce.db
# Адрес USDT (TRC-20) для оплаты тарифов — показывается на странице /pricing.
# Задайте на сервере, например:  Environment=KAIRI_PAY_TO=TYourWalletAddress
Environment=KAIRI_PAY_TO=
# Пробный период в днях при регистрации (по умолчанию 3, если не задано).
Environment=KAIRI_TRIAL_DAYS=3
# Скан рынка для Telegram-алертов: пусто = выключен (безопасно по умолчанию).
# Заполните на сервере в этом файле, например:
#   Environment=KAIRI_ALERT_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
Environment=KAIRI_ALERT_SYMBOLS=
Environment=KAIRI_ALERT_SCAN_MIN=15
Restart=on-failure
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable --now kairi-api >/dev/null 2>&1 || systemctl restart kairi-api || true
sleep 2
curl -sf http://127.0.0.1:8000/api/quotes/healthz >/dev/null \
  && echo "    Commerce API работает (127.0.0.1:8000)" \
  || echo "    !! Commerce API не отвечает — фронтенд деградирует на прямые запросы к Bybit"

echo "==> 4/11 Node.js 22 LTS (нужен для сборки фронтенда)"
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

echo "==> 5/11 Подготовка окружения nginx (IPv6, конфликты default_server, leftover-конфиги)"
if [ ! -e /proc/net/if_inet6 ]; then
    sed -ri 's/^(\s*)listen\s+\[::\]:80.*/\1# disabled (no IPv6): &/' /etc/nginx/sites-available/default /etc/nginx/conf.d/*.conf 2>/dev/null || true
fi
# Удаляем наши же старые версии конфигов, чтобы они не конфликтовали
# с новым конфигом kairi (дублирующиеся default_server на 80/443)
rm -f /etc/nginx/sites-enabled/nison /etc/nginx/sites-enabled/kairi-pro \
      /etc/nginx/conf.d/kairi.conf /etc/nginx/conf.d/nison.conf
# Отключаем стандартный Debian-конфиг, если он объявляет default_server (конфликт с нашим)
if grep -qsE '^\s*listen\s+(\[::\]:)?80\s+default_server' /etc/nginx/sites-enabled/default 2>/dev/null; then
    rm -f /etc/nginx/sites-enabled/default
fi
dpkg --configure -a 2>/dev/null || true

echo "==> 6/11 Сборка фронтенда из GitHub (main)"
rm -rf "$BUILD_DIR"
git clone --depth 50 "$REPO" -b main "$BUILD_DIR"
cd "$BUILD_DIR"
npm ci --silent --no-audit --no-fund
npm run build

echo "==> 7/11 Публикация статики в $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/"*
cp -r dist/* "$WEB_ROOT/"
# Токен доступа к серверному журналу: встраивается в index.html, браузер
# шлёт его в X-Kairi-Key (см. src/utils/journalSync.ts). TTL 12 часов —
# пересоздание страницы после протухания возвращает локальный режим до
# следующего деплоя; статика защищена от чтения посторонними (0640+www-data).
JOURNAL_TOKEN=""
if [ -f /opt/kairi-journal/journal_token.py ] && ! [ -f /tmp/kairi_journal_broken ]; then
    JOURNAL_TOKEN=$(python3 /opt/kairi-journal/journal_token.py --ttl 43200 2>/dev/null || true)
fi
# Расширенный JSON-токен (role=user) для котировочного API quotes_server.py.
# Встраивается отдельным meta-тегом; journal-токен старого формата остаётся
# для обратной совместимости (journal_server.verify принимает именно его).
API_TOKEN=""
if [ -f /opt/kairi-api/journal_token.py ] && ! [ -f /tmp/kairi_api_broken ]; then
    API_TOKEN=$(/opt/kairi-api/venv/bin/python3 /opt/kairi-api/journal_token.py --ttl 43200 --json 2>/dev/null \
                | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null || true)
fi
if [ -n "$JOURNAL_TOKEN" ]; then
    sed -i "s|</title>|</title>\n    <meta name=\"kairi-journal-token\" content=\"$JOURNAL_TOKEN\">|" "$WEB_ROOT/index.html"
    echo "    Токен журнала встроен в index.html (TTL 12ч)"
else
    echo "    !! Токен журнала не выдан — синхронизация будет работать в локальном режиме"
fi
if [ -n "$API_TOKEN" ]; then
    sed -i "s|</title>|</title>\n    <meta name=\"kairi-api-token\" content=\"$API_TOKEN\">|" "$WEB_ROOT/index.html"
    echo "    Токен котировочного API встроен в index.html (TTL 12ч)"
else
    echo "    !! Токен котировочного API не выдан — котировки пойдут напрямую (fallback)"
fi
chown -R www-data:www-data "$WEB_ROOT" && chmod -R a+rX "$WEB_ROOT"
[ -n "$JOURNAL_TOKEN" ] && chmod 640 "$WEB_ROOT/index.html"

echo "==> 8/11 Настройка nginx (домен $DOMAIN) + запуск"
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
        root $WEB_ROOT;
    }
$( [ "$with_ssl" = "yes" ] && echo '
    # robots.txt отдаём по HTTP напрямую (200, без редиректа): поисковые
    # роботы (и проверки Яндекс.Вебмастера) не переходят по 301 на
    # robots.txt и выдают предупреждение «сервер отвечает редиректом».
    location = /robots.txt {
        root /var/www/nison-analytics;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }' || echo '
    # сертификат ещё не выпущен — отдаём сайт по HTTP напрямую
    root /var/www/nison-analytics;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/journal/ {
        # 401 — штатный ответ при неверном ключе; nginx по умолчанию сам
        # подмешивает CORS-заголовки на 4xx, из-за чего браузер скрывал
        # настоящий статус (CORS error вместо 401) и диагностика была невозможна.
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        add_header Access-Control-Allow-Origin "https://kairi.pro" always;
        add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Kairi-Key" always;
        add_header Vary "Origin" always;
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

    # robots.txt и sitemap.xml отдаём с корректным Content-Type и без кеширования:
    # поисковые роботы часто игнорируют файлы, отданные как text/html (SPA-fallback),
    # а закешированный sitemap не обновляется после деплоя
    location = /sitemap.xml {
        default_type application/xml;
        add_header Cache-Control "no-cache, must-revalidate";
        try_files \$uri =404;
    }
    location = /robots.txt {
        default_type text/plain;
        add_header Cache-Control "no-cache, must-revalidate";
        try_files \$uri =404;
    }

    # серверное хранилище журнала сигналов (python API на localhost:8787)
    location /api/journal/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_read_timeout 15s;
        add_header Access-Control-Allow-Origin "https://kairi.pro" always;
        add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Kairi-Key" always;
        add_header Vary "Origin" always;
    }

    # коммерческий backend (FastAPI на localhost:8000): котировочный прокси,
    # тарифы и подписки. Котировки кэшируются на сервере — браузер больше не
    # ходит на api.bybit.com напрямую (CSP connect-src 'self').
    location /api/quotes/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_read_timeout 15s;
        add_header Cache-Control "no-store" always;
    }
    location /api/plans {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_read_timeout 10s;
    }
    location /api/subscriptions {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_read_timeout 10s;
    }
    # регистрация аккаунта (email -> user_id + trial-подписка)
    location /api/register {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_read_timeout 10s;
    }
    # очередь алертов (статус/привязка Telegram; ручной запуск — мастер-ключом)
    location /api/alerts/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_read_timeout 30s;
    }

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://stream.bybit.com wss://stream.binance.com:9443 https://mc.yandex.ru; img-src 'self' data: https://mc.yandex.ru; font-src 'self' data:; frame-ancestors 'none'; upgrade-insecure-requests;" always;
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

who_listens() {
    # $1 = порт; показать, кто занимает порт (для диагностики)
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp 2>/dev/null | grep -E ":$1\b" || true
    else
        netstat -ltnp 2>/dev/null | grep -E ":$1\b" || true
    fi
}

free_nginx_procs() {
    # Полностью гасим ВСЕ процессы nginx (в т.ч. осиротевшие мастера,
    # оставшиеся от ручного запуска в прошлых прогонах — они держат порты
    # и не видны systemctl). Дождитесь завершения, затем SIGKILL.
    for i in 1 2 3; do
        pgrep -x nginx >/dev/null 2>&1 || return 0
        pkill -x nginx >/dev/null 2>&1 || true
        sleep 1
    done
    pkill -9 -x nginx >/dev/null 2>&1 || true
    sleep 1
}

start_nginx_via_systemd() {
    systemctl reset-failed nginx 2>/dev/null || true
    if systemctl start nginx 2>/dev/null; then
        sleep 1
        systemctl is-active --quiet nginx && return 0
    fi
    return 1
}

# Корректный (пере)запуск nginx: сначала пробуем штатный restart; если порт
# занят осиротевшим процессом — убиваем ВСЕ nginx и стартуем через systemd.
systemctl enable nginx >/dev/null 2>&1 || true
if ! systemctl restart nginx; then
    echo "    systemctl restart не удался — показываем, кто занимает порты, и убиваем все процессы nginx"
    journalctl -u nginx --no-pager -n 5 2>/dev/null | grep emerg || true
    echo "    Занято портов: [80] $(who_listens 80 | tr '\n' ' ') [443] $(who_listens 443 | tr '\n' ' ')"
    free_nginx_procs
    if ! start_nginx_via_systemd; then
        echo "    !! systemd не поднимает nginx — запускаем напрямую (после полной очистки процессов):"
        nginx || {
            echo "    !! Прямой запуск тоже не удался. Кто слушает 80/443 сейчас:"
            who_listens 80; who_listens 443
            echo "       Попробуйте найти чужой сервис: systemctl list-units --type=service --state=running"
        }
    fi
fi
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true

# фаервол (если ufw активен)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null || true
fi

echo "==> 9/11 Диагностика доступности портов 80/443 снаружи"
# Проверка идёт через внешний сервис (scan.nmap.org), т.к. локальная проверка
# не видит файрвол провайдера. Если порт закрыт — сертификат LE получить нельзя,
# но сайт продолжит работать по http:// и повторится попытка при следующем запуске.
PORTS_OK=""
if command -v nmap >/dev/null 2>&1; then
    SCAN=$(nmap -Pn --host_timeout 20000 -p 80,443 scan.nmap.org 2>/dev/null || true)
else
    SCAN=$( (timeout 25 bash -c 'exec 3<>/dev/tcp/scan.nmap.org/80' && echo "80 open") 2>/dev/null || echo "80 closed/filtered"; \
            (timeout 25 bash -c 'exec 3<>/dev/tcp/scan.nmap.org/443' && echo "443 open") 2>/dev/null || echo "443 closed/filtered"; )
fi
echo "    Результат внешней проверки портов сервера:"
echo "$SCAN" | grep -E "^(80|443) " | sed 's/^/      /'
if echo "$SCAN" | grep -qE "^80 (open|filtered)"; then
    PORTS_OK="maybe"
fi
[ "$PORTS_OK" = "maybe" ] || echo "    !! Порт 80 недоступен снаружи (файрвол провайдера или блокировка на сервере)."
if command -v iptables >/dev/null 2>&1; then
    IPT=$(iptables -S 2>/dev/null | grep -E 'DROP|REJECT' || true)
    if [ -n "$IPT" ]; then
        echo "    На сервере найдены правила iptables DROP/REJECT — добавляем исключения для 80/443:"
        echo "$IPT" | sed 's/^/      /'
        iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
    else
        echo "    Локальный iptables чист (правил DROP/REJECT нет) — если порт закрыт, это файрвол хостинга."
    fi
fi

echo "==> 10/11 SSL-сертификат Let's Encrypt для $DOMAIN"
SERVER_IP=$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
ISSUED=""
SKIP_CERTBOT=""
[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && SKIP_CERTBOT="yes"
for host in "$DOMAIN" "$WWW_DOMAIN"; do
    [ -n "$SKIP_CERTBOT" ] && break
    # проверяем ПУБЛИЧНЫЕ резолверы (Google/Cloudflare), т.к. локальный DNS может отдавать устаревший кеш
    EXT_RESOLVED=$(for r in 8.8.8.8 1.1.1.1; do timeout 5 python3 -c "
import dns.resolver
try:
    res=dns.resolver.Resolver(configure=False); res.nameservers=['$r']
    print('\n'.join(a.to_text() for a in res.resolve('$host','A')))
except Exception: pass" 2>/dev/null; done | sort -u | tr '\n' ' ')
    case " $EXT_RESOLVED " in
        *" $SERVER_IP "*) ;;
        *) echo "    !! $host резолвится на [$EXT_RESOLVED], а не на IP сервера [$SERVER_IP] — выпуск пропускаем. Исправьте/удалите лишние A-записи у регистратора."; continue ;;
    esac
    # если домен ведёт НЕ только на нас — HTTP-челлендж может уйти на чужой сервер, ставим standalone
    MULTI_IP="no"
    [ "$(echo "$EXT_RESOLVED" | wc -w)" -gt 1 ] && MULTI_IP="yes"
    OK=""
    issue_cert() {
        # $1 = authenticator: webroot | standalone
        if [ "$1" = "standalone" ]; then
            # временная остановка nginx, чтобы освободить порт 80
            systemctl stop nginx 2>/dev/null || true
            free_nginx_procs
            certbot certonly --standalone --preferred-port 80 -d "$host" \
                --non-interactive --agree-tos -m "admin@$DOMAIN" --keep-until-expiring 2>&1 \
            || certbot certonly --standalone --preferred-port 80 -d "$host" \
                --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring 2>&1
            RC=$?
            start_nginx_via_systemd || nginx 2>/dev/null || true
            return $RC
        else
            mkdir -p "$WEB_ROOT/.well-known/acme-challenge"
            certbot certonly --webroot -w "$WEB_ROOT" -d "$host" \
                --non-interactive --agree-tos -m "admin@$DOMAIN" --keep-until-expiring 2>&1 \
            || certbot certonly --webroot -w "$WEB_ROOT" -d "$host" \
                --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring 2>&1
            return $?
        fi
    }
    ensure_nginx() {
        # nginx должен работать через systemd; осиротевшие процессы от
        # предыдущих прогонов держат порты — полная очистка + старт
        if ! pgrep -x nginx >/dev/null 2>&1; then
            start_nginx_via_systemd || nginx 2>/dev/null || true
        elif [ ! -f /run/nginx.pid ] || ! systemctl is-active --quiet nginx 2>/dev/null; then
            free_nginx_procs
            start_nginx_via_systemd || nginx 2>/dev/null || true
        fi
    }
    if [ "$MULTI_IP" = "yes" ]; then
        issue_cert standalone && OK="yes"
    else
        # основной путь: webroot (nginx остаётся запущенным)
        issue_cert webroot && OK="yes"
    fi
    ensure_nginx
    if [ -z "$OK" ]; then
        # Финальная попытка: DNS-01 — порт 80 снаружи не нужен вообще.
        # Certbot сам создаст TXT-запись _acme-challenge в Temporary ACME DNS
        # (https://temporaryacme.diafore.com), LE проверит её публично.
        echo "    Пробую выпуск через DNS (Temporary ACME DNS, порт 80 не нужен)..."
        mkdir -p /etc/letsencrypt
        cat > /etc/letsencrypt/temp-acme.ini <<'EOF'
certbot-plugin = certbot_dns_tempacme.dns_tempacme:DNSCreator
EOF
        if ! python3 -c "import certbot_dns_tempacme" 2>/dev/null; then
            (pip3 install --break-system-packages -q certbot-dns-tempacme 2>/dev/null \
              || pip3 install -q certbot-dns-tempacme 2>/dev/null \
              || python3 -m pip install --break-system-packages -q certbot-dns-tempacme 2>/dev/null) || true
        fi
        if python3 -c "import certbot_dns_tempacme" 2>/dev/null; then
            certbot certonly --configurator nginx --non-interactive --agree-tos \
                -m "admin@$DOMAIN" --keep-until-expiring -d "$host" \
                --dns-tempacme-propagation-seconds 15 \
                --server "https://diafore-temp-acme.diafore.com/directory" \
                --dns-credential /etc/letsencrypt/temp-acme.ini 2>&1 && OK="yes"
        else
            echo "    Plugin certbot-dns-tempacme не установлен — DNS-выпуск пропущен."
        fi
    fi
    if [ -n "$OK" ]; then
        ISSUED="yes"
        echo "    Сертификат выпущен/обновлён для $host"
    else
        echo "    !! Не удалось получить сертификат для $host"
        echo "       Причины: (1) порт 80 закрыт файрволом провайдера — см. диагностику выше;"
        echo "       (2) A-запись ведёт не на сервер (Google DNS: $EXT_RESOLVED)."
    fi
done
if [ -n "$ISSUED" ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    # переписываем конфиг уже с настоящими сертификатами и редиректом HTTP->HTTPS
    write_nginx_conf yes
    nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null)
fi
[ -z "$ISSUED" ] && echo "    WARNING: ни один хост не получил сертификат — сайт будет доступен только по http://"
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true

echo "==> 11/11 Автопродление сертификатов (certbot renew)"
mkdir -p /etc/cron.d
cat > /etc/cron.d/kairi-certbot-renew <<'EOF'
0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx || nginx -s reload"
EOF
chmod 0644 /etc/cron.d/kairi-certbot-renew

rm -rf "$BUILD_DIR"

echo "==> Финальная самодиагностика деплоя (rev $DEPLOY_SCRIPT_REV)"
# Проверям, что именно ЭТА ревизия скрипта реально отработала: если в выводе
# нет строки «DEPLOY_REVISION=v12», значит был запущен устаревший кэш скрипта
# (bash/ curl / старый raw-кеш GitHub) и «деплой» не применил новые конфиги.
echo "    DEPLOY_REVISION=$DEPLOY_SCRIPT_REV"
DIAG_FAIL=""
if nginx -T 2>/dev/null | grep -q "location /api/quotes/"; then
    echo "    OK   nginx: location /api/quotes/ присутствует"
else
    echo "    !!   nginx: /api/quotes/ НЕ найден в конфиге — проверьте sites-enabled/kairi"
    DIAG_FAIL="yes"
fi
if nginx -T 2>/dev/null | grep -q "location /api/register"; then
    echo "    OK   nginx: location /api/register присутствует (v13)"
else
    echo "    !!   nginx: /api/register НЕ найден — страница «Тарифы» не сможет регистрировать пользователей"
    DIAG_FAIL="yes"
fi
curl -sf http://127.0.0.1:8000/api/quotes/healthz >/dev/null 2>&1 \
    && echo "    OK   commerce API (:8000) отвечает" \
    || { echo "    !!   commerce API (:8000) не отвечает — systemctl status kairi-api"; DIAG_FAIL="yes"; }
curl -sf http://127.0.0.1:8787/healthz >/dev/null 2>&1 \
    && echo "    OK   journal API (:8787) отвечает" \
    || echo "    ..   journal API (:8787) молчит — журнал останется локальным"
BUNDLE=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$WEB_ROOT/index.html" 2>/dev/null | head -1)
echo "    Бандл во фронтенде: ${BUNDLE:-не найден}"
grep -q 'kairi-api-token' "$WEB_ROOT/index.html" 2>/dev/null \
    && echo "    OK   токен котировочного API встроен в index.html" \
    || echo "    ..   токена котировочного API нет — фронт деградирует на прямые запросы к Bybit"
[ -z "$DIAG_FAIL" ] && echo "    Все критичные проверки пройдены."

echo ""
echo "✅ Готово."
if [ -n "$ISSUED" ]; then
    echo "   Откройте в браузере: https://$DOMAIN"
else
    echo "   Сайт доступен по HTTP: http://$DOMAIN (по IP тоже работает)"
    echo "   HTTPS пока без валидного сертификата (самоподписанный — браузер покажет предупреждение)."
    echo ""
    echo "   Чтобы получить бесплатный сертификат Let's Encrypt, порт 80 должен быть"
    echo "   открыт ВОВНЕ. Раз в панели хостинга нет настройки портов:"
    echo "     1) напишите в поддержку хостинга: «прошу открыть входящие порты 80/tcp и 443/tcp»;"
    echo "     2) или попробуйте выпуск по DNS (порт 80 не нужен):"
    echo "        apt-get install -y python3-pip && pip3 install --break-system-packages certbot-dns-plugins 2>/dev/null;"
    echo "        certbot certonly --manual --preferred-challenges dns -d $DOMAIN -d *.$DOMAIN"
    echo "        (нужно будет добавить TXT-запись _acme-challenge у регистратора);"
    echo "     3) после открытия порта/выпуска — повторите эту команду установки, и"
    echo "        nginx сам переключится на HTTPS с редиректом с HTTP."
fi
