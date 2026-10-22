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

echo "==> 1/9 Установка пакетов (nginx, git, curl, certbot)"
# v2: bootstrap-fix (certbot webroot, self-signed до выпуска LE)
export DEPLOY_SCRIPT_REV="v8"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx python3-dnspython || {
    echo "Установка прервалась — донастраиваем dpkg и повторяем";
    dpkg --configure -a; apt-get install -y -qq nginx git curl ca-certificates gnupg certbot python3-certbot-nginx python3-dnspython; }

echo "==> 2/9 Node.js 22 LTS (нужен для сборки фронтенда)"
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

echo "==> 3/9 Подготовка окружения nginx (IPv6, конфликты default_server, leftover-конфиги)"
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

echo "==> 4/9 Сборка фронтенда из GitHub (main)"
rm -rf "$BUILD_DIR"
git clone --depth 50 "$REPO" -b main "$BUILD_DIR"
cd "$BUILD_DIR"
npm ci --silent --no-audit --no-fund
npm run build

echo "==> 5/9 Публикация статики в $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/"*
cp -r dist/* "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT" && chmod -R a+rX "$WEB_ROOT"

echo "==> 6/9 Настройка nginx (домен $DOMAIN) + запуск"
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

echo "==> 7/9 Диагностика доступности портов 80/443 снаружи"
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

echo "==> 8/9 SSL-сертификат Let's Encrypt для $DOMAIN"
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

echo "==> 9/9 Автопродление сертификатов (certbot renew)"
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
