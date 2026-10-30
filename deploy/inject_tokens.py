#!/usr/bin/env python3
"""Kairi Analytics — инъекция браузерных токенов в index.html после деплоя статики.

Решает проблему 403 на /api/quotes/*: dist/index.html из git-репозитория не
содержит meta kairi-api-token / kairi-journal-token (они выдаются с секретов
боевого сервера и не могут лежать в публичном репо). Скрипт запускается на
сервере после копирования статики, генерирует оба токена тем же кодом, что и
vps_setup.sh (server/journal_token.py), и вставляет их в <title>...</title>.

Использование (root на боевом сервере):
    python3 /opt/kairi-api/journal_token.py --help   # проверка модуля
    WEB_DIR=/var/www/nison-analytics python3 inject_tokens.py
Идемпотентен: старые meta-теги заменяются новыми.
"""
import os
import re
import sys

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/nison-analytics")
INDEX = os.path.join(WEB_DIR, "index.html")
TTL = int(os.environ.get("KAIRI_TOKEN_TTL", "43200"))  # 12 часов

# journal_token.py: серверный установочный путь > рядом со скриптом > репозиторий
CANDIDATES = [
    "/opt/kairi-journal/journal_token.py",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "journal_token.py"),
    "/opt/nison-build/server/journal_token.py",
]
syspath = next((p for p in CANDIDATES if os.path.isfile(p)), None)
if not syspath:
    print("!! journal_token.py не найден ни в /opt/kairi-journal, ни рядом со скриптом, "
          "ни в /opt/nison-build/server — сначала выполните restart_kairi_api.sh")
    sys.exit(1)
sys.path.insert(0, os.path.dirname(syspath))
import journal_token as jt  # noqa: E402

if not os.path.isfile(INDEX):
    print(f"!! {INDEX} не найден — укажите WEB_DIR=<путь к статике>")
    sys.exit(1)

html = open(INDEX, encoding="utf-8").read()
# удалить прежние injected-теги (идемпотентность)
html = re.sub(r'\n\s*<meta name="kairi-(api|journal)-token"[^>]*>', "", html)

journal_tok = jt.issue(TTL)                      # классический "<exp>.<hmac>"
api_json = jt.issue_json(TTL, role="user")       # JSON-токен role=user
api_tok = api_json["token"]

anchor = "</title>"
inject = (f'{anchor}\n    <meta name="kairi-journal-token" content="{journal_tok}">'
          f'\n    <meta name="kairi-api-token" content="{api_tok}">')
if anchor not in html:
    print("!! в index.html нет </title> — аномальная сборка"); sys.exit(1)
html = html.replace(anchor, inject, 1)

open(INDEX, "w", encoding="utf-8").write(html)
os.chmod(INDEX, 0o640)
print(f"OK: токены встроены в {INDEX} (TTL {TTL//3600}ч, exp "
      f"{__import__('datetime').datetime.fromtimestamp(api_json['expiresAt'])}). "
      "Не забудьте chown www-data:www-data при необходимости.")
