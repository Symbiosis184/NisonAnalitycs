#!/usr/bin/env python3
"""Kairi Analytics — выдача браузерных токенов доступа к журналу.

Журнал сигналов синхронизируется браузером с journal_server.py через
заголовок X-Kairi-Key. Раньше этот ключ лежал в /etc/kairi/journal.key и
его нельзя было отдать клиенту без компрометации всего API (включая
DELETE). Решение: HMAC-подписанные токены с ограниченным TTL.

Токен:  <expiration>.<hmac_sha256(secret, expiration)>   (hex)
Секрет: /etc/kairi/journal.token_secret (0600, создаётся автоматически).

Разрешение токена = запись/чтение журнала в течение TTL; токен НЕ даёт
права на DELETE и не является мастер-ключом: украсть его — всё равно что
получить доступ к собственному журналу на час.

Использование:
    python3 journal_token.py            # выдать токен (stdout)
    python3 journal_token.py --ttl 3600 # TTL в секундах (по умолчанию 900)
    echo TOKEN | python3 journal_token.py --verify   # проверка токена
"""
import hmac
import hashlib
import os
import sys
import time

SECRET_FILE = os.environ.get(
    "KAIRI_JOURNAL_TOKEN_SECRET", "/etc/kairi/journal.token_secret"
)
DEFAULT_TTL = int(os.environ.get("KAIRI_JOURNAL_TOKEN_TTL", "900"))


def load_secret() -> bytes:
    """Читает секрет; при отсутствии создаёт новый (как journal.key)."""
    try:
        with open(SECRET_FILE, "rb") as f:
            secret = f.read().strip()
            if secret:
                return secret
    except OSError:
        pass
    secret = os.urandom(32)
    d = os.path.dirname(SECRET_FILE) or "."
    os.makedirs(d, exist_ok=True)
    fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(secret + b"\n")
    return secret


def sign(secret: bytes, expiration: int) -> str:
    return hmac.new(secret, str(expiration).encode("ascii"), hashlib.sha256).hexdigest()


def issue(ttl: int = DEFAULT_TTL) -> str:
    secret = load_secret()
    exp = int(time.time()) + max(60, min(ttl, 24 * 3600))
    return f"{exp}.{sign(secret, exp)}"


def verify(token: str) -> bool:
    """True, если токен подписан секретом и не просрочен."""
    try:
        exp_s, sig = token.strip().split(".", 1)
        exp = int(exp_s)
    except (ValueError, AttributeError):
        return False
    if exp < time.time():
        return False
    secret = load_secret()
    expected = sign(secret, exp)
    return hmac.compare_digest(sig.lower(), expected)


def main() -> int:
    args = sys.argv[1:]
    if "--verify" in args:
        token = sys.stdin.read()
        return 0 if verify(token) else 1
    ttl = DEFAULT_TTL
    if "--ttl" in args:
        try:
            ttl = int(args[args.index("--ttl") + 1])
        except (IndexError, ValueError):
            print("usage: --ttl SECONDS", file=sys.stderr)
            return 2
    print(issue(ttl))
    return 0


if __name__ == "__main__":
    sys.exit(main())
