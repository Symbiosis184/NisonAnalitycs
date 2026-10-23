#!/usr/bin/env python3
"""Kairi Analytics — серверное хранилище журнала сигналов.

Минималистичный HTTP-API поверх sqlite3 (стандартная библиотека, без
внешних зависимостей). Работает как systemd-сервис на 127.0.0.1:8787,
nginx проксирует на него /api/journal с домена kairi.pro.

Хранилище: SQLite (WAL) — надёжнее JSON-файла (атомарные записи), не
требует установки Node-зависимостей на VPS.

Эндпоинты:
  GET    /healthz              -> {"ok":true}
  GET    /api/journal/signals  -> {signals:[...], updatedAt}
  POST   /api/journal/sync     -> merge по id/barTime; ответ = полный журнал
  DELETE /api/journal/signals/<id>
  POST   /api/journal/replace  -> полная замена (импорт из файла браузера)

Безопасность: ключ доступа X-Kairi-Key сверяется с /etc/kairi/journal.key
(создаётся деплой-скриптом, права 600). Пустой файл ключа = доступ только
с localhost (защита от случайного проброса API наружу без секрета).
"""
import hmac
import json
import os
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("KAIRI_JOURNAL_DB", "/var/lib/kairi/journal.db")
KEY_FILE = os.environ.get("KAIRI_JOURNAL_KEY_FILE", "/etc/kairi/journal.key")
BIND = os.environ.get("KAIRI_JOURNAL_BIND", "127.0.0.1")
PORT = int(os.environ.get("KAIRI_JOURNAL_PORT", "8787"))
MAX_BODY = 5 * 1024 * 1024          # 5 МБ на запрос
MAX_SIGNALS = 5000                  # потолок записей в журнале
STATUSES = ("pending", "hit_target", "hit_stop", "expired")
DIRECTIONS = ("long", "short")

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SYMBOL_RE = re.compile(r"^[A-Z0-9]{3,25}$")
TIMEFRAME_RE = re.compile(r"^[MmHhDdWw][0-9a-zA-Z]{0,4}$")


def access_key() -> str:
    try:
        with open(KEY_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with sqlite3.connect(DB_PATH) as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS signals (
                id TEXT PRIMARY KEY,
                bar_time INTEGER,
                payload TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def sanitize_signal(raw):
    """Строгая валидация одной записи (зеркало фронтендовой санитизации)."""
    if not isinstance(raw, dict):
        return None
    sid = raw.get("id")
    if not isinstance(sid, str) or not ID_RE.match(sid):
        return None
    symbol = raw.get("symbol")
    if not isinstance(symbol, str) or not SYMBOL_RE.match(symbol.upper()):
        return None
    tf = raw.get("timeframe")
    if not isinstance(tf, str) or not TIMEFRAME_RE.match(tf):
        return None
    direction = raw.get("direction")
    if direction not in DIRECTIONS:
        return None
    status = raw.get("status")
    if status not in STATUSES:
        return None

    def num(key, lo, hi, default=None):
        v = raw.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if lo <= v <= hi:
                return v
        return default

    entry_price = num("entryPrice", 1e-8, 1e12)
    if entry_price is None:
        return None

    s = {
        "id": sid,
        "timestamp": int(num("timestamp", 0, time.time() * 1000 + 864e5, time.time() * 1000)),
        "symbol": symbol.upper(),
        "timeframe": tf,
        "pattern": str(raw.get("pattern", "unknown"))[:100],
        "direction": direction,
        "entryPrice": entry_price,
        "stopLoss": num("stopLoss", 0, 1e12, entry_price),
        "target": num("target", 0, 1e12, entry_price),
        "riskReward": num("riskReward", 0, 1000, 0),
        "confidence": num("confidence", 0, 100, 0),
        "status": status,
    }
    for key, lo, hi in (
        ("exitPrice", 0, 1e12),
        ("pnl", -1e12, 1e12),
        ("pnlPercent", -1e6, 1e6),
        ("netPnlPercent", -1e6, 1e6),
        ("costsR", -1000, 0),
        ("exitTimestamp", 0, time.time() * 1000 + 864e5),
    ):
        v = num(key, lo, hi)
        if v is not None:
            s[key] = v
    notes = raw.get("notes")
    if isinstance(notes, str) and notes.strip():
        s["notes"] = notes[:500]
    bt = num("barTime", 1, time.time() * 1000 + 864e5)
    if bt is not None:
        s["barTime"] = int(bt)
    return s


def load_all(c):
    rows = c.execute(
        "SELECT payload FROM signals ORDER BY updated_at DESC LIMIT ?",
        (MAX_SIGNALS,),
    ).fetchall()
    out = []
    for (payload,) in rows:
        try:
            out.append(json.loads(payload))
        except json.JSONDecodeError:
            pass
    return out


def event_key(s):
    """Идентичность события для кросс-девайс дедупликации."""
    return (s.get("symbol"), s.get("timeframe"), s.get("pattern"),
            s.get("direction"), s.get("barTime"))


class Handler(BaseHTTPRequestHandler):
    server_version = "KairiJournal/1.0"

    # --- инфраструктура ---
    def log_message(self, fmt, *args):  # тихий лог (идёт в journald)
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # preflight для запросов с заголовком X-Kairi-Key
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def _authorized(self):
        key = access_key()
        if not key:
            # ключ не задан — разрешаем только loopback (защита от утечки наружу)
            return self.client_address[0] in ("127.0.0.1", "::1")
        supplied = self.headers.get("X-Kairi-Key", "")
        return hmac.compare_digest(supplied, key)

    def _cors(self):
        """CORS для запросов с домена приложения (браузер шлёт заголовок
        X-Kairi-Key — это уже не «простой» запрос, без preflight синхронизация
        блокируется ещё до обращения к API)."""
        origin = self.headers.get("Origin", "")
        allowed = os.environ.get(
            "KAIRI_ALLOWED_ORIGINS",
            "https://kairi.pro,https://www.kairi.pro",
        )
        if origin and origin in [o.strip() for o in allowed.split(",")]:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Kairi-Key")
            self.send_header("Access-Control-Max-Age", "86400")

    # --- маршруты ---
    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, {"ok": True})
        if self.path.startswith("/api/journal/signals"):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            with conn() as c:
                signals = load_all(c)
                row = c.execute("SELECT MAX(updated_at) FROM signals").fetchone()
            return self._send(200, {"signals": signals, "updatedAt": row[0] or 0})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/api/journal/"):
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        data = self._read_json()
        if data is None:
            return self._send(400, {"error": "invalid json body"})

        with conn() as c:
            if self.path.startswith("/api/journal/replace"):
                incoming = data.get("signals") if isinstance(data, dict) else None
                if not isinstance(incoming, list):
                    return self._send(400, {"error": "expected {signals:[...]}"})
                clean = [s for s in (sanitize_signal(x) for x in incoming[:MAX_SIGNALS]) if s]
                now = time.time()
                c.execute("DELETE FROM signals")
                c.executemany(
                    "INSERT INTO signals (id, bar_time, payload, updated_at) VALUES (?,?,?,?)",
                    [(s["id"], s.get("barTime"), json.dumps(s, ensure_ascii=False), now) for s in clean],
                )
                return self._send(200, {"signals": clean, "replaced": len(clean)})

            if self.path.startswith("/api/journal/sync"):
                incoming = data.get("signals") if isinstance(data, dict) else None
                if not isinstance(incoming, list):
                    return self._send(400, {"error": "expected {signals:[...]}"})
                clean = [s for s in (sanitize_signal(x) for x in incoming[:MAX_SIGNALS]) if s]
                existing = load_all(c)
                by_id = {s["id"]: s for s in existing}
                events = {}
                for s in existing:
                    if s.get("barTime") is not None:
                        events.setdefault(event_key(s), s["id"])
                now = time.time()
                added = updated = deduped = 0
                rows = []
                for s in clean:
                    old = by_id.get(s["id"])
                    if old is None and s.get("barTime") is not None:
                        twin = events.get(event_key(s))
                        if twin is not None:
                            # то же событие уже сохранено с другим id (другое
                            # устройство) — не плодим дубли в серверном журнале
                            deduped += 1
                            continue
                    if old is None:
                        added += 1
                    else:
                        updated += 1
                    if s.get("barTime") is not None:
                        events.setdefault(event_key(s), s["id"])
                    rows.append((s["id"], s.get("barTime"), json.dumps(s, ensure_ascii=False), now))
                if rows:
                    c.executemany(
                        "INSERT INTO signals (id, bar_time, payload, updated_at) VALUES (?,?,?,?) "
                        "ON CONFLICT(id) DO UPDATE SET bar_time=excluded.bar_time, "
                        "payload=excluded.payload, updated_at=excluded.updated_at",
                        rows,
                    )
                merged = load_all(c)
                row = c.execute("SELECT MAX(updated_at) FROM signals").fetchone()
                return self._send(200, {
                    "signals": merged,
                    "updatedAt": row[0] or 0,
                    "added": added, "updated": updated, "deduped": deduped,
                })

            return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if not self.path.startswith("/api/journal/signals/"):
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        sid = self.path.rsplit("/", 1)[-1]
        if not ID_RE.match(sid):
            return self._send(400, {"error": "bad id"})
        with conn() as c:
            cur = c.execute("DELETE FROM signals WHERE id=?", (sid,))
        return self._send(200, {"deleted": cur.rowcount})


def main():
    init_db()
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"Kairi journal API on http://{BIND}:{PORT} (db={DB_PATH})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
