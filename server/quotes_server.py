#!/usr/bin/env python3
"""Kairi Analytics — коммерческий backend-API (FastAPI).

Сервис работает как systemd-unit на 127.0.0.1:8000, nginx проксирует /api/.

Модули:
  1. Котировочный прокси (Bybit/Binance) с серверным кэшем и in-flight
     дедупликацией. Фронтенд больше НЕ ходит на api.bybit.com напрямую —
     CSP сокращается до connect-src 'self' + wss://stream.bybit.com.
       GET /api/quotes/klines?exchange=bybit&symbol=BTCUSDT&interval=60&limit=200
       GET /api/quotes/ticker?exchange=bybit&symbol=BTCUSDT
       GET /api/quotes/healthz
  2. Тарифы и подписки (SQLite; миграция на Postgres — отдельным шагом):
       GET  /api/plans
       POST /api/subscriptions            (создать/продлить по токену оплаты)
       GET  /api/subscriptions/<user_id>  (статус активной подписки)
  3. Проверка доступа по HMAC-подписанному токenu (X-Kairi-Key), TTL 15 мин,
     вместо открытого доступа. Мастер-ключ — /etc/kairi/journal.key (общий
     с журналом), секрет платёжного вебхука — /etc/kairi/payment_secret.
  4. Очередь задач для алертов (APScheduler in-process; Celery+Redis — позже,
     при переходе на несколько воркеров): периодический скан рынка, push
     подтверждённых сигналов в Telegram.
       GET /api/alerts/status
       POST /api/alerts/run               (мастер-ключ: ручной запуск скана)
       POST /api/alerts/telegram_bind     (user_id <- {chat_id, token})

Запуск (dev):  uvicorn quotes_server:app --port 8000
Окружение:
  KAIRI_QUOTES_DB      (по умолчанию /var/lib/kairi/commerce.db)
  KAIRI_MASTER_KEY_FILE(/etc/kairi/journal.key)
  KAIRI_PAYMENT_SECRET_FILE (/etc/kairi/payment_secret)
  KAIRI_QUOTES_ALLOWED_HOSTS (по умолчанию api.bybit.com,api.binance.com)
  KAIRI_ALERT_SCAN_MIN (интервал скана, мин; 0 = выключить)
  KAIRI_ALERT_SYMBOLS  (список сканирования, через запятую)
  KAIRI_ALERT_TF       (таймфрейм скана, по умолчанию 1h)
"""
import calendar
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import urllib.parse
from contextlib import contextmanager
from typing import Any, Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request

# --- Конфиг ------------------------------------------------------------------

DB_PATH = os.environ.get("KAIRI_QUOTES_DB", "/var/lib/kairi/commerce.db")
MASTER_KEY_FILE = os.environ.get("KAIRI_MASTER_KEY_FILE", "/etc/kairi/journal.key")
PAYMENT_SECRET_FILE = os.environ.get("KAIRI_PAYMENT_SECRET_FILE", "/etc/kairi/payment_secret")
TOKEN_TTL_S = int(os.environ.get("KAIRI_TOKEN_TTL", "900"))

ALLOWED_EXCHANGES = {
    "bybit": "https://api.bybit.com",
    "binance": "https://api.binance.com",
    # TradFi: американские акции — Twelvedata (бесплатный тариф, API-ключ на сервере).
    "twelvedata": "https://api.twelvedata.com",
}
# SSRF-защита: хост котировочных источников фиксируется списком из env.
ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.environ.get(
        "KAIRI_QUOTES_ALLOWED_HOSTS",
        "api.bybit.com,api.binance.com,api.twelvedata.com",
    ).split(",")
    if h.strip()
}

# Twelvedata требует API-ключ (бесплатный тариф: 800 запросов/мин, 8000/сутки).
# Ключ задаётся ТОЛЬКО на сервере: env KAIRI_TWELVEDATA_API_KEY или файл
# /etc/kairi/twelvedata.key (см. deploy/vps_setup.sh). В браузер он не попадает.
TWELVEDATA_API_KEY_FILE = os.environ.get("KAIRI_TWELVEDATA_KEY_FILE", "/etc/kairi/twelvedata.key")


def _load_twelvedata_key() -> str:
    key = os.environ.get("KAIRI_TWELVEDATA_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(TWELVEDATA_API_KEY_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


TWELVEDATA_API_KEY = _load_twelvedata_key()

# Серверная пауза между исходящими запросами к источнику акций (страховка
# поверх клиентского троттлера во фронтенде; дефицит ключа тоже считается).
TWELVEDATA_MIN_INTERVAL_S = float(os.environ.get("KAIRI_TWELVEDATA_MIN_INTERVAL", "0.25"))
_td_lock = threading.Lock()
_td_last_at = [0.0]


def _twelvedata_throttle() -> None:
    """Блокирующая пауза до следующего разрешённого запроса к Twelvedata."""
    with _td_lock:
        wait = TWELVEDATA_MIN_INTERVAL_S - (time.time() - _td_last_at[0])
        if wait > 0:
            time.sleep(wait)
        _td_last_at[0] = time.time()


SYMBOL_RE = re.compile(r"^[A-Z0-9]{3,25}$")
# Фондовый тикер вида 'AAPL:STOCK' (см. src/api/market.ts): база 1–10 символов.
STOCK_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}:STOCK$")
INTERVAL_RE = re.compile(r"^[0-9]{1,4}[mMhHdDwW]?$|^[DdWw]$")

USER_ID_RE = re.compile(r"^[a-z0-9_-]{3,64}$")

KLINES_TTL = {"m": 30, "h": 120, "d": 3600, "w": 21600}  # секунды по шагу ТФ


def _read_secret(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


# --- HMAC-токены доступа ------------------------------------------------------

def sign_payload(payload: dict, secret: str) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def verify_access_token(token: str, role_required: Optional[str] = None) -> Optional[dict]:
    """Возвращает payload токена, если подпись/HMAC/TTL валидны."""
    secret = _read_secret(MASTER_KEY_FILE)
    if not secret or "." not in token:
        return None
    body, _, sig = token.rpartition(".")
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    if payload.get("exp", 0) < time.time():
        return None
    if role_required and payload.get("role") != role_required:
        return None
    return payload


def require_key(x_kairi_key: Optional[str]) -> dict:
    if not x_kairi_key:
        raise HTTPException(status_code=401, detail="missing X-Kairi-Key")
    payload = verify_access_token(x_kairi_key)
    if payload is None:
        raise HTTPException(status_code=403, detail="invalid or expired token")
    return payload


# --- Хранилище (SQLite; схема совместима с Postgres) --------------------------

_lock = threading.Lock()


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price_usdt INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payment_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id, expires_at);
-- колонка status (pending/active) добавляется миграцией ниже (совместимость
-- с уже существующими боевыми БД, созданными до коммерческого контура v2)
CREATE TABLE IF NOT EXISTS processed_payments (
  payment_hash TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_log (
  dedup_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
"""

# telegram_bindings — общая таблица алертов (определена один раз)
SCHEMA += """
CREATE TABLE IF NOT EXISTS telegram_bindings (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  token TEXT NOT NULL
);
"""


def _migrate(con: sqlite3.Connection) -> None:
    """Идемпотентные ALTER для боевых БД предыдущих версий."""
    cols = {r["name"] for r in con.execute("PRAGMA table_info(users)").fetchall()}
    if "email" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN email TEXT")
    subs_cols = {r["name"] for r in con.execute("PRAGMA table_info(subscriptions)").fetchall()}
    if "status" not in subs_cols:
        con.execute("ALTER TABLE subscriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")

DEFAULT_PLANS = [
    ("month", "Подписка на 1 месяц", 49, 30),
    ("quarter", "Подписка на 3 месяца", 119, 90),
    ("year", "Подписка на 1 год", 399, 365),
]


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)
        _migrate(con)
        for pid, title, price, days in DEFAULT_PLANS:
            con.execute(
                "INSERT OR IGNORE INTO plans(id,title,price_usdt,duration_days) VALUES(?,?,?,?)",
                (pid, title, price, days),
            )


# --- Котировочный кэш ----------------------------------------------------------

class QuoteCache:
    def __init__(self):
        self._data: dict[str, tuple[float, Any]] = {}
        self._inflight: dict[str, threading.Event] = {}
        self._results: dict[str, Any] = {}
        self._lock = threading.Lock()

    @staticmethod
    def kline_ttl(interval: str) -> int:
        # Ключи — ТОЛЬКО канонические интервалы приложения ('15','30','60',
        # '120','240','D','W','M' и крипто-минутные формы). Проверка по точному
        # совпадению: эвристики вроде endswith("m") ошибочно относили месячные
        # 'M' к минутным (TTL 30 с вместо 6 ч) и раздували запросы к источнику.
        i = interval.lower()
        if i in ("d", "1d"):
            return KLINES_TTL["d"]
        if i in ("w", "1w"):
            return KLINES_TTL["w"]
        if i in ("m", "1mo"):
            return KLINES_TTL["w"]  # месячные бары обновляются редко
        if i in ("60", "120", "240", "480", "1h", "2h", "4h", "8h"):
            return KLINES_TTL["h"]
        return KLINES_TTL["m"]  # 1/3/5/15/30 и прочие минуты

    # Короткий TTL для неудачных обращений к источнику: без него каждая
    # перезагрузка страницы снова «долбит» источник заведомо падающим
    # запросом (429-спирали, неизвестные тикеры). Для rate-limit ошибок
    # (429) держим троттл дольше — 80 секунд, чтобы успел восстановиться
    # лимит Twelvedata (~800 запросов/мин); прочие ошибки — 20 секунд.
    ERROR_TTL_S = 20
    RATE_LIMIT_TTL_S = 80

    @classmethod
    def _err_ttl(cls, exc: BaseException) -> int:
        status = getattr(exc, "status_code", None)
        return cls.RATE_LIMIT_TTL_S if status == 429 else cls.ERROR_TTL_S

    # serving-stale (staple): если источник недоступен (429/5xx/timeout), а
    # у ключа есть данные не старше STALE_MAX_S — отдаём их вместо ошибки.
    # Пользователь видит карточки с прошлыми ценами, а не «Ошибка загрузки».
    STALE_MAX_S = 3 * 3600

    def get_or_fetch(self, key: str, ttl: int, fetcher, force: bool = False):
        now = time.time()
        with self._lock:
            hit = self._data.get(key)
            if not force and hit and hit[0] > now:
                # свежая ошибка в кэше — зеркалим её, не дёргая источник
                if isinstance(hit[1], BaseException):
                    err = hit[1]
                    if isinstance(err, HTTPException):
                        raise err
                    raise HTTPException(status_code=502, detail=str(err) or "upstream error")
                return hit[1], True
            ev = self._inflight.get(key)
            if ev is not None:
                wait = True
            else:
                ev = threading.Event()
                self._inflight[key] = ev
                wait = False
        if wait:
            ev.wait(timeout=15)
            with self._lock:
                res = self._results.get(key)
            if isinstance(res, BaseException):
                # лидер упал — сначала пробуем отдать протухшие данные (stale)
                stale = self.get_stale(key)
                if stale is not None:
                    return stale, True
                # the leader's upstream request failed — mirror its error
                if isinstance(res, HTTPException):
                    raise res
                raise HTTPException(status_code=502, detail=str(res) or "upstream error")
            if res is not None:
                return res, True
            raise HTTPException(status_code=504, detail="upstream timeout")
        try:
            value = fetcher()
        except BaseException as exc:  # noqa: BLE001 — propagate to waiters too
            with self._lock:
                self._results[key] = exc
                ev.set()
                self._inflight.pop(key, None)
                # запоминаем ошибку на короткий TTL (не перекрываем свежие данные)
                prev = self._data.get(key)
                if prev is None or prev[0] <= time.time():
                    self._data[key] = (time.time() + self._err_ttl(exc), exc)
            # serving-stale: есть относительно свежие данные — отдаём их,
            # а ошибку оставляем в кэше как троттл для последующих запросов.
            # ВАЖНО: берём значение напрямую из _data (успешное значение там
            # перезаписывается только успешным fetch'ем) — get_stale читает
            # _results, куда лидер только что записал исключение.
            stale = self._stale_value(key)
            if stale is not None:
                return stale, True
            raise
        with self._lock:
            self._results[key] = value
            ev.set()
            self._inflight.pop(key, None)
            self._data[key] = (time.time() + ttl, value)
        return value, False

    def get_stale(self, key: str):
        """Данные (не ошибка) не старше STALE_MAX_S, даже если TTL истёк."""
        with self._lock:
            hit = self._data.get(key)
        if hit and not isinstance(hit[1], BaseException) \
                and hit[0] >= time.time() - self.STALE_MAX_S:
            return hit[1]
        return None

    def _stale_value(self, key: str):
        """Stale-значение из _data без чтения _results (исключений там полно)."""
        with self._lock:
            hit = self._data.get(key)
        if hit and not isinstance(hit[1], BaseException) \
                and hit[0] >= time.time() - self.STALE_MAX_S:
            return hit[1]
        return None


cache = QuoteCache()

BYBIT_INTERVAL = {  # канон приложения -> Bybit
    "1m": "1", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "1d": "D", "1w": "W",
}
BINANCE_INTERVAL = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1d", "1w": "1w",
}
# TradFi (Twelvedata time_series): интервал эндпоинта + шаг в секундах.
# Бесплатный тариф отдаёт годы дневной/недельной/месячной истории и несколько
# месяцев внутридневных данных — этого хватает для всех ТФ приложения.
# Wire-формы интервалов Twelvedata (проверено живым запросом):
# 1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 8h, 1day, 1week, 1month.
# '1hour' и т.п. — НЕ поддерживаются (400 Bad Request).
TD_INTERVAL = {
    "1m": ("1min", 60), "1": ("1min", 60),
    "5m": ("5min", 300), "5": ("5min", 300),
    "15m": ("15min", 900), "15": ("15min", 900),
    "30m": ("30min", 1800), "30": ("30min", 1800),
    "1h": ("1h", 3600), "60": ("1h", 3600),
    "2h": ("2h", 7200), "120": ("2h", 7200),
    "4h": ("4h", 14400), "240": ("4h", 14400),
    "8h": ("8h", 28800), "480": ("8h", 28800),
    "1d": ("1day", 86400), "d": ("1day", 86400), "D": ("1day", 86400),
    "1w": ("1week", 604800), "w": ("1week", 604800), "W": ("1week", 604800),
    "1mo": ("1month", 2592000), "m": ("1month", 2592000), "M": ("1month", 2592000),
}


def _normalize_bybit_klines(raw: dict) -> list[dict]:
    out = []
    for row in raw.get("result", {}).get("list", []):
        out.append({
            "openTime": int(row[0]), "open": float(row[1]), "high": float(row[2]),
            "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]),
        })
    return out[::-1]  # Bybit отдаёт новые->старые; приводим к хронологии


def _normalize_binance_klines(raw: list) -> list[dict]:
    return [{
        "openTime": int(r[0]), "open": float(r[1]), "high": float(r[2]),
        "low": float(r[3]), "close": float(r[4]), "volume": float(r[5]),
    } for r in raw]


def _raise_td_error(body: dict) -> None:
    """Единая расшифровка error-ответов Twelvedata (HTTP 429 и 200-with-error)."""
    msg = str(body.get("message", ""))
    low = msg.lower()
    if ("/api/rate" in msg or "rate limit" in low or "credits" in low
            or "per minute" in low or "per day" in low):
        # Пример: "You have run out of API credits for the current minute..."
        raise HTTPException(status_code=429, detail="twelvedata rate limited")
    if "quota" in low:
        raise HTTPException(status_code=429, detail="twelvedata daily quota exceeded")
    if "invalid interval" in low or "symbol not found" in low:
        raise HTTPException(status_code=400, detail="bad request to twelvedata")
    raise HTTPException(status_code=404, detail="unknown symbol")


def _normalize_td_klines(raw: Any) -> list[dict]:
    """Twelvedata time_series -> канон Kline[] (хронологический порядок).

    Ответ: {values:[{datetime,open,high,low,close,volume},...]} — новые->старые.
    Дневной формат 'YYYY-MM-DD'; внутридневные 'YYYY-MM-DD HH:mm:ss' — время
    биржевое (exchange_timezone), переводим в epoch по локальному часовому
    поясу сервера (на VPS это UTC; для NYSE-сессии это детерминированный сдвиг,
    одинаковый для всех баров одного интервала).
    """
    if isinstance(raw, dict) and raw.get("status") == "error":
        _raise_td_error(raw)
    values = raw.get("values") if isinstance(raw, dict) else None
    if not isinstance(values, list):
        raise HTTPException(status_code=404, detail="no data for symbol")
    out = []
    for v in reversed(values):  # к хронологии
        try:
            dt = str(v["datetime"])
            if len(dt) <= 10:  # 'YYYY-MM-DD' (1day/1week/1month)
                ts = calendar.timegm(time.strptime(dt, "%Y-%m-%d"))
            else:              # 'YYYY-MM-DD HH:mm[:ss]' (внутридневные)
                fmt = "%Y-%m-%d %H:%M:%S" if len(dt) >= 19 else "%Y-%m-%d %H:%M"
                ts = int(time.mktime(time.strptime(dt, fmt)))
            out.append({
                "openTime": ts * 1000,
                "open": float(v["open"]), "high": float(v["high"]),
                "low": float(v["low"]), "close": float(v["close"]),
                "volume": float(v.get("volume") or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    if not out:
        raise HTTPException(status_code=404, detail="empty candle series")
    return out


def _td_get(path: str, params: dict) -> Any:
    """GET к Twelvedata API с серверным ключом, троттлингом и разбором ошибок."""
    if not TWELVEDATA_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="twelvedata api key is not configured (KAIRI_TWELVEDATA_API_KEY)")
    _twelvedata_throttle()
    url = f"{ALLOWED_EXCHANGES['twelvedata']}{path}"
    host = url.split("/")[2].lower()
    if host not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="host not allowed")
    q = dict(params)
    q["apikey"] = TWELVEDATA_API_KEY
    try:
        r = httpx.get(url, params=q, timeout=8.0,
                      headers={"Accept": "application/json"})
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="twelvedata rate limited")
        if r.status_code in (401, 403):
            raise HTTPException(status_code=502, detail="twelvedata key rejected")
        if r.status_code == 404:
            # Twelvedata отвечает 404 и на неизвестный тикер — различаем по телу
            try:
                eb = r.json()
            except Exception:
                eb = None
            msg = str((eb or {}).get("message", "")) if isinstance(eb, dict) else ""
            if "/api/rate" in msg or "rate limit" in msg.lower() or "quota" in msg.lower():
                raise HTTPException(status_code=429, detail="twelvedata rate limited")
            raise HTTPException(status_code=404, detail="unknown symbol")
        r.raise_for_status()
        body = r.json()
        # Twelvedata может вернуть 200 с error-телом (неизвестный тикер/лимит)
        if isinstance(body, dict) and body.get("status") == "error":
            _raise_td_error(body)
        return body
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"upstream {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=504, detail=f"upstream error: {type(e).__name__}")


def _http_get(url: str, params: dict) -> Any:
    host = url.split("/")[2].lower() if "//" in url else ""
    if host not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="host not allowed")
    try:
        r = httpx.get(url, params=params, timeout=8.0)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"upstream {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=504, detail=f"upstream error: {type(e).__name__}")


# --- Приложение ----------------------------------------------------------------

app = FastAPI(title="Kairi Commerce API", version="1.0", docs_url=None, redoc_url=None)
init_db()


@app.get("/api/quotes/healthz")
def healthz():
    return {"ok": True, "service": "quotes"}


@app.get("/api/quotes/klines")
def quotes_klines(
    symbol: str = Query(...),
    interval: str = Query("1h"),
    limit: int = Query(200, ge=1, le=1000),
    exchange: str = Query("bybit"),
    _t: int = Query(None),  # force-bust клиентского кэша (закрытие бара по WS)
    x_kairi_key: Optional[str] = Header(None),
):
    require_key(x_kairi_key)
    is_stock = bool(STOCK_SYMBOL_RE.match(symbol))
    if not (SYMBOL_RE.match(symbol) or is_stock):
        raise HTTPException(status_code=400, detail="bad symbol")
    iv = interval.lower()  # канон для кэша/проверок; TD_INTERVAL содержит и 'D'/'W'/'M'
    if exchange == "twelvedata":
        if not is_stock:
            raise HTTPException(status_code=400, detail="twelvedata requires TICKER:STOCK")
        if iv not in TD_INTERVAL:
            raise HTTPException(status_code=400, detail="bad interval")
    elif iv not in BYBIT_INTERVAL:
        raise HTTPException(status_code=400, detail="bad interval")
    if exchange not in ALLOWED_EXCHANGES:
        raise HTTPException(status_code=400, detail="unknown exchange")

    key = f"k:{exchange}:{symbol}:{iv}:{limit}"

    def fetch():
        if exchange == "twelvedata":
            base = symbol.split(":")[0]
            tv, _step_s = TD_INTERVAL[iv]
            # time_series отдаёт последние outputsize баров — окно не нужно;
            # запас +10 на случай отброшенных битых строк, режем по limit ниже.
            body = _td_get("/time_series", {
                "symbol": base, "interval": tv,
                "outputsize": str(min(5000, limit + 10)),
                "format": "JSON"})
            return _normalize_td_klines(body)
        if exchange == "bybit":
            data = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/v5/market/kline", {
                "category": "spot", "symbol": symbol,
                "interval": BYBIT_INTERVAL[iv], "limit": limit})
            return _normalize_bybit_klines(data)
        data = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/api/v3/klines", {
            "symbol": symbol, "interval": BINANCE_INTERVAL[iv], "limit": limit})
        return _normalize_binance_klines(data)

    value, from_cache = cache.get_or_fetch(key, cache.kline_ttl(iv), fetch, force=_t is not None)
    if exchange == "twelvedata" and isinstance(value, list) and len(value) > limit:
        value = value[-limit:]  # outputsize даёт запас сверху — режем по limit
    return {"data": value, "cached": from_cache, "exchange": exchange}


@app.get("/api/quotes/ticker")
def quotes_ticker(
    symbol: str = Query(...),
    exchange: str = Query("bybit"),
    x_kairi_key: Optional[str] = Header(None),
):
    require_key(x_kairi_key)
    is_stock = bool(STOCK_SYMBOL_RE.match(symbol))
    if not (SYMBOL_RE.match(symbol) or is_stock):
        raise HTTPException(status_code=400, detail="bad symbol")
    if exchange not in ALLOWED_EXCHANGES:
        raise HTTPException(status_code=400, detail="unknown exchange")

    key = f"t:{exchange}:{symbol}"

    def fetch():
        if exchange == "twelvedata":
            # /quote: percent_change уже в процентах (-1.18655 => -1.18655%).
            base = symbol.split(":")[0]
            body = _td_get("/quote", {"symbol": base})
            if not isinstance(body, dict) or body.get("status") == "error" \
                    or body.get("symbol") is None:
                raise HTTPException(status_code=404, detail="unknown symbol")
            try:
                last_f = float(body["close"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(status_code=404, detail="unknown symbol")
            if last_f <= 0:
                raise HTTPException(status_code=404, detail="unknown symbol")

            def _f(name):
                try:
                    return float(body[name])
                except (KeyError, TypeError, ValueError):
                    return None

            pct = _f("percent_change")
            change = _f("change")
            prev = _f("previous_close")
            if change is None and prev is not None:
                change = last_f - prev
            if pct is None and prev and prev > 0:
                pct = (last_f - prev) / prev * 100
            return {"lastPrice": last_f,
                    "priceChange": round(change if change is not None else 0.0, 8),
                    "priceChangePercent": round(pct if pct is not None else 0.0, 4)}
        if exchange == "bybit":
            rows = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/v5/market/tickers",
                             {"category": "spot", "symbol": symbol}
                             ).get("result", {}).get("list", [])
            if not rows:
                raise HTTPException(status_code=404, detail="unknown symbol")
            r = rows[0]
            last = float(r["lastPrice"])
            pct = float(r["price24hPcnt"]) * 100
            return {"lastPrice": last, "priceChangePercent": round(pct, 2),
                    "priceChange": round(last * float(r["price24hPcnt"]), 8)}
        rows = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/api/v3/ticker/24hr",
                         {"symbol": symbol})
        return {"lastPrice": float(rows["lastPrice"]),
                "priceChangePercent": float(rows["priceChangePercent"]),
                "priceChange": float(rows["priceChange"])}

    value, from_cache = cache.get_or_fetch(key, 10, fetch)
    return {"data": value, "cached": from_cache, "exchange": exchange}


# --- Планы/подписки --------------------------------------------------------------

# Адрес приёма оплаты (USDT TRC-20 / TON). Задаётся на сервере env-файлом
# KAIRI_PAY_TO в /etc/kairi/env (см. deploy/vps_setup.sh); подставляется
# деплойным скриптом из systemd EnvironmentFile.
PAY_TO_ADDRESS = os.environ.get("KAIRI_PAY_TO", "")
TRIAL_DAYS = int(os.environ.get("KAIRI_TRIAL_DAYS", "3"))


@app.get("/api/plans")
def plans():
    """Публичный список тарифов (без токена) — страница «Тарифы»."""
    with db() as con:
        rows = con.execute(
            "SELECT id,title,price_usdt,duration_days FROM plans WHERE active=1"
            " ORDER BY duration_days").fetchall()
    return {"plans": [dict(r) for r in rows], "payTo": PAY_TO_ADDRESS,
            "trialDays": TRIAL_DAYS}


def _subscription_state(con: sqlite3.Connection, user_id: str) -> dict:
    row = con.execute(
        "SELECT plan_id, MAX(expires_at) AS exp FROM subscriptions "
        "WHERE user_id=? AND status='active' AND expires_at > ? GROUP BY plan_id "
        "ORDER BY exp DESC LIMIT 1", (user_id, int(time.time()))).fetchone()
    if row is None:
        pending = con.execute(
            "SELECT plan_id FROM subscriptions WHERE user_id=? AND status='pending' "
            "ORDER BY started_at DESC LIMIT 1", (user_id,)).fetchone()
        if pending:
            p = con.execute("SELECT title FROM plans WHERE id=?",
                            (pending["plan_id"],)).fetchone()
            return {"active": False, "pending": pending["plan_id"],
                    "pendingTitle": p["title"] if p else pending["plan_id"]}
        return {"active": False}
    plan = con.execute("SELECT title FROM plans WHERE id=?", (row["plan_id"],)).fetchone()
    return {"active": True, "plan": row["plan_id"],
            "planTitle": plan["title"] if plan else row["plan_id"],
            "expiresAt": row["exp"]}


@app.post("/api/register")
async def register(request: Request):
    """Регистрация покупателя: публичный user_id + trial-подписка.

    Тело: {email?}. Возвращает user_id, который клиент сохраняет локально и
    использует во всех платных эндпоинтах. Повторная регистрация по тому же
    email возвращает существующий user_id (идемпотентно). Trial включается,
    если KAIRI_TRIAL_DAYS > 0 и у пользователя ещё нет ни одной записи.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    email = str(body.get("email", "")).strip().lower()[:254]
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="bad email")
    now = int(time.time())
    with _lock, db() as con:
        if email:
            existing = con.execute(
                "SELECT id FROM users WHERE lower(email)=?", (email,)).fetchone()
            if existing:
                return {"user_id": existing["id"],
                        **_subscription_state(con, existing["id"])}
        # детерминированный public-id из email или случайного seed
        if email:
            user_id = "k_" + hashlib.sha256(email.encode()).hexdigest()[:12]
        else:
            user_id = "k_" + os.urandom(6).hex()
        con.execute("INSERT OR IGNORE INTO users(id, email, created_at) VALUES(?,?,?)",
                    (user_id, email or None, now))
        state = _subscription_state(con, user_id)
        if not state["active"] and TRIAL_DAYS > 0:
            has_any = con.execute(
                "SELECT 1 FROM subscriptions WHERE user_id=? LIMIT 1",
                (user_id,)).fetchone()
            if not has_any:
                con.execute(
                    "INSERT INTO subscriptions(user_id,plan_id,started_at,expires_at,"
                    "payment_ref) VALUES(?,?,?,?,?)",
                    (user_id, "trial", now, now + TRIAL_DAYS * 86400, "trial"))
                state = _subscription_state(con, user_id)
        return {"user_id": user_id, **state}


@app.post("/api/subscriptions")
async def create_subscription(
    request: Request,
    x_kairi_key: Optional[str] = Header(None),
):
    """Активация/продление подписки.

    Два режима:
      1. Клиентский (X-Kairi-Key, роль user/legacy): тело
         {user_id, plan_id, payment_tx}. Заявка уходит в статус `pending` —
         оплата on-chain проверяется вручную/watcher'ом. Как только платёж
         подтверждён (админ вызывает этот же эндпоинт с режимом 2 либо
         POST /api/subscriptions/confirm), подписка активируется; повторные
         заявки того же плана идемпотентны.
      2. Серверный (секрет платёжного вебхука в X-Payment-Sig): тело
         {user_id, plan_id, payment:{hash, amount_usdt, ts}} — HMAC-подпись
         watcher'а, мгновенная активация (прежнее поведение).
    """
    body = await request.json()
    user_id = str(body.get("user_id", ""))
    plan_id = str(body.get("plan_id", ""))
    if not USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="bad user_id")

    # --- Режим 2: HMAC от платёжного watcher'а (мгновенная активация) ------
    sig_hdr = None
    for k, v in request.headers.items():
        if k.lower() == "x-payment-sig":
            sig_hdr = v
            break
    if sig_hdr:
        secret = _read_secret(PAYMENT_SECRET_FILE)
        payment = body.get("payment") or {}
        phash = str(payment.get("hash", ""))
        pts = int(payment.get("ts", 0))
        if not secret or not phash or abs(time.time() - pts) > 86400:
            raise HTTPException(status_code=402, detail="payment not confirmed")
        expected = hmac.new(secret.encode(), f"{phash}:{user_id}:{plan_id}".encode(),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig_hdr):
            raise HTTPException(status_code=402, detail="bad payment signature")
        payload = {"role": "internal"}
    else:
        # --- Режим 1: клиентская заявка ------------------------------------
        payload = require_key(x_kairi_key)
        if payload.get("role") not in (None, "user"):
            raise HTTPException(status_code=403, detail="wrong role")

    with _lock, db() as con:
        plan = con.execute("SELECT * FROM plans WHERE id=? AND active=1", (plan_id,)).fetchone()
        if plan is None:
            raise HTTPException(status_code=400, detail="unknown plan")

        if payload.get("role") == "internal":
            payment = body.get("payment") or {}
            phash = str(payment.get("hash", ""))
            if int(payment.get("amount_usdt", 0)) < plan["price_usdt"]:
                raise HTTPException(status_code=402, detail="underpaid")
            if con.execute("SELECT 1 FROM processed_payments WHERE payment_hash=?",
                           (phash,)).fetchone():
                return _subscription_state(con, user_id) | {"idempotent": True}
            now = int(time.time())
            base = con.execute(
                "SELECT MAX(expires_at) AS m FROM subscriptions WHERE user_id=?",
                (user_id,)).fetchone()["m"]
            start = max(now, base or 0)
            con.execute("INSERT OR IGNORE INTO users(id, created_at) VALUES(?,?)", (user_id, now))
            con.execute(
                "INSERT INTO subscriptions(user_id,plan_id,started_at,expires_at,payment_ref) "
                "VALUES(?,?,?,?,?)",
                (user_id, plan_id, now, start + plan["duration_days"] * 86400, phash))
            con.execute("INSERT INTO processed_payments(payment_hash, processed_at) VALUES(?,?)",
                        (phash, now))
            return _subscription_state(con, user_id)

        # Клиентская заявка: pending до подтверждения платежа
        tx = str(body.get("payment_tx", ""))[:128]
        now = int(time.time())
        existing = con.execute(
            "SELECT status FROM subscriptions WHERE user_id=? AND plan_id=? "
            "AND status='pending' ORDER BY started_at DESC LIMIT 1",
            (user_id, plan_id)).fetchone()
        if existing:
            return {"status": "pending", "plan": plan_id,
                    "planTitle": plan["title"], "idempotent": True}
        con.execute("INSERT OR IGNORE INTO users(id, created_at) VALUES(?,?)", (user_id, now))
        con.execute(
            "INSERT INTO subscriptions(user_id,plan_id,started_at,expires_at,payment_ref,status) "
            "VALUES(?,?,?,?,?,'pending')",
            (user_id, plan_id, now, 0, tx or None))
        return {"status": "pending", "plan": plan_id, "planTitle": plan["title"],
                "payTo": PAY_TO_ADDRESS, "amountUsdt": plan["price_usdt"]}


@app.post("/api/subscriptions/confirm")
async def confirm_subscription(
    request: Request,
    x_kairi_key: Optional[str] = Header(None),
):
    """Подтверждение заявки админом (роль admin в X-Kairi-Key).

    Тело: {user_id, plan_id}. Pending-заявка превращается в активную
    подписку (продление от текущей даты окончания).
    """
    payload = require_key(x_kairi_key)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    body = await request.json()
    user_id = str(body.get("user_id", ""))
    plan_id = str(body.get("plan_id", ""))
    if not USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="bad user_id")
    with _lock, db() as con:
        row = con.execute(
            "SELECT id, plan_id FROM subscriptions WHERE user_id=? AND plan_id=? "
            "AND status='pending' ORDER BY started_at DESC LIMIT 1",
            (user_id, plan_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="no pending request")
        plan = con.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        now = int(time.time())
        base = con.execute(
            "SELECT MAX(expires_at) AS m FROM subscriptions "
            "WHERE user_id=? AND status='active'", (user_id,)).fetchone()["m"]
        start = max(now, base or 0)
        con.execute(
            "UPDATE subscriptions SET status='active', started_at=?, expires_at=? WHERE id=?",
            (now, start + plan["duration_days"] * 86400, row["id"]))
        return _subscription_state(con, user_id)


@app.get("/api/subscriptions/{user_id}")
def subscription_status(user_id: str, x_kairi_key: Optional[str] = Header(None)):
    require_key(x_kairi_key)
    if not USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="bad user_id")
    with db() as con:
        return _subscription_state(con, user_id)


# --- Очередь задач: скан рынка + Telegram-алерты подтверждённых сигналов -------
# In-process APScheduler (один uvicorn-worker; при переходе на несколько
# воркеров переносим на Celery+Redis — интерфейс эндпоинтов сохранится).

ALERT_SCAN_MIN = int(os.environ.get("KAIRI_ALERT_SCAN_MIN", "15"))
ALERT_SYMBOLS = [s.strip().upper() for s in
                 os.environ.get("KAIRI_ALERT_SYMBOLS", "").split(",") if s.strip()]
ALERT_TF = os.environ.get("KAIRI_ALERT_TF", "1h")

_scheduler = None
_alert_state: dict = {"lastRun": 0, "lastResult": None, "signalsPushed": 0}


def _active_subscribers() -> list[dict]:
    now = int(time.time())
    with db() as con:
        rows = con.execute(
            "SELECT DISTINCT user_id FROM subscriptions WHERE status='active' AND expires_at > ?",
            (now,)).fetchall()
        out = []
        for r in rows:
            ch = con.execute(
                "SELECT chat_id, token FROM telegram_bindings WHERE user_id=?",
                (r["user_id"],)).fetchone()
            if ch:
                out.append({"user_id": r["user_id"],
                            "chat_id": ch["chat_id"], "token": ch["token"]})
    return out


def scan_and_alert() -> dict:
    """Скан тикеров: резкое движение >=3% за 24ч считаем «подтверждённым
    алертом» и рассылаем подписчикам с привязанным Telegram. Дедупликация по
    (symbol|direction|день), чтобы не спамить при повторных сканах."""
    result = {"scanned": 0, "alerts": [], "pushed": 0, "errors": 0}
    if not ALERT_SYMBOLS:
        result["note"] = "KAIRI_ALERT_SYMBOLS пуст — скан ничего не делает"
        _alert_state.update(lastRun=int(time.time()), lastResult=result)
        return result
    subscribers = _active_subscribers()
    day = time.strftime("%Y-%m-%d")
    with db() as con:
        for sym in ALERT_SYMBOLS[:50]:
            try:
                data, _ = cache.get_or_fetch(
                    f"t:bybit:{sym}", 10,
                    lambda sym=sym: _fetch_ticker_bybit(sym))
            except Exception:
                result["errors"] += 1
                continue
            result["scanned"] += 1
            pct = data["priceChangePercent"]
            if abs(pct) < 3.0:
                continue
            direction = "up" if pct > 0 else "down"
            dedup = f"{sym}|{direction}|{day}"
            if con.execute("SELECT 1 FROM alert_log WHERE dedup_key=?",
                           (dedup,)).fetchone():
                continue
            con.execute("INSERT INTO alert_log(dedup_key, created_at) VALUES(?,?)",
                        (dedup, int(time.time())))
            msg = (f"Kairi alert: {sym} {direction}, 24h {pct:+.2f}%, "
                   f"last {data['lastPrice']:g}")
            result["alerts"].append({"symbol": sym, "direction": direction,
                                     "pct": pct})
            for sub in subscribers:
                try:
                    tg_send_message(sub["token"], sub["chat_id"], msg)
                    result["pushed"] += 1
                except Exception:
                    result["errors"] += 1
    _alert_state.update(lastRun=int(time.time()), lastResult=result)
    _alert_state["signalsPushed"] += result["pushed"]
    return result


def _fetch_ticker_bybit(symbol: str) -> dict:
    rows = _http_get(f"{ALLOWED_EXCHANGES['bybit']}/v5/market/tickers",
                     {"category": "spot", "symbol": symbol}
                     ).get("result", {}).get("list", [])
    if not rows:
        raise ValueError(f"unknown symbol {symbol}")
    r = rows[0]
    last = float(r["lastPrice"])
    pct = float(r["price24hPcnt"]) * 100
    return {"lastPrice": last, "priceChangePercent": round(pct, 2),
            "priceChange": round(last * float(r["price24hPcnt"]), 8)}


def tg_send_message(bot_token: str, chat_id: str, text: str) -> None:
    """Отправка в Telegram через api.telegram.org."""
    httpx.post(f"https://api.telegram.org/bot{bot_token}/sendMessage",
               json={"chat_id": chat_id, "text": text}, timeout=8.0
               ).raise_for_status()


def _start_scheduler():
    global _scheduler
    if ALERT_SCAN_MIN <= 0 or _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        return  # очередь выключена: pip-зависимость не установлена
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(scan_and_alert, "interval", minutes=ALERT_SCAN_MIN,
                       max_instances=1, coalesce=True)
    _scheduler.start()


@app.on_event("startup")
def _startup():
    _start_scheduler()


@app.get("/api/alerts/status")
def alerts_status(x_kairi_key: Optional[str] = Header(None)):
    require_key(x_kairi_key)
    return {"enabled": ALERT_SCAN_MIN > 0, "intervalMin": ALERT_SCAN_MIN,
            "symbols": ALERT_SYMBOLS,
            "schedulerRunning": bool(_scheduler and _scheduler.running),
            **_alert_state}


@app.post("/api/alerts/run")
def alerts_run(x_kairi_key: Optional[str] = Header(None)):
    payload = require_key(x_kairi_key)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin token required")
    return scan_and_alert()


@app.post("/api/alerts/telegram_bind")
async def telegram_bind(request: Request, x_kairi_key: Optional[str] = Header(None)):
    payload = require_key(x_kairi_key)
    if payload.get("role") not in (None, "user"):
        raise HTTPException(status_code=403, detail="wrong role")
    body = await request.json()
    user_id = str(body.get("user_id", ""))
    chat_id = str(body.get("chat_id", ""))
    token = str(body.get("token", ""))
    if not USER_ID_RE.match(user_id) or not re.match(r"^-?\d{5,20}$", chat_id):
        raise HTTPException(status_code=400, detail="bad user_id/chat_id")
    if not re.match(r"^\d{6,12}:[A-Za-z0-9_-]{30,50}$", token):
        raise HTTPException(status_code=400, detail="bad bot token format")
    with db() as con:
        con.execute(
            "INSERT INTO telegram_bindings(user_id, chat_id, token) VALUES(?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id, "
            "token=excluded.token", (user_id, chat_id, token))
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("KAIRI_QUOTES_BIND", "127.0.0.1"), port=8000)
