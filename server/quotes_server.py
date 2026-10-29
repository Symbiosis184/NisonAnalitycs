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
    # TradFi: американские акции — Yahoo Finance chart API (бесплатно, без ключа).
    "yahoo": "https://query1.finance.yahoo.com",
}
# SSRF-защита: хост котировочных источников фиксируется списком из env.
ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.environ.get(
        "KAIRI_QUOTES_ALLOWED_HOSTS",
        "api.bybit.com,api.binance.com,query1.finance.yahoo.com,query2.finance.yahoo.com",
    ).split(",")
    if h.strip()
}

# Yahoo Finance не требует ключа, но отдаёт 429 запросам без нормального
# User-Agent и агрессивно троттлит спам — держим серверную паузу между
# исходящими запросами (страховка поверх клиентского троттлера во фронтенде).
YAHOO_MIN_INTERVAL_S = float(os.environ.get("KAIRI_YAHOO_MIN_INTERVAL", "0.5"))
YAHOO_USER_AGENT = os.environ.get(
    "KAIRI_YAHOO_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
)
_yahoo_lock = threading.Lock()
_yahoo_last_at = [0.0]


def _yahoo_throttle() -> None:
    """Блокирующая пауза до следующего разрешённого запроса к Yahoo Finance."""
    with _yahoo_lock:
        wait = YAHOO_MIN_INTERVAL_S - (time.time() - _yahoo_last_at[0])
        if wait > 0:
            time.sleep(wait)
        _yahoo_last_at[0] = time.time()


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
        i = interval.lower()
        if i.endswith("m"):
            return KLINES_TTL["m"]
        if i.endswith("h") or i in ("60", "240"):
            return KLINES_TTL["h"]
        if i in ("d", "1d"):
            return KLINES_TTL["d"]
        if i in ("w", "1w"):
            return KLINES_TTL["w"]
        return KLINES_TTL["m"]

    # Короткий TTL для неудачных обращений к источнику: без него каждая
    # перезагрузка страницы снова «долбит» Yahoo/Bybit заведомо падающим
    # запросом (429-спирали, неизвестные тикеры). 20 секунд — достаточно,
    # чтобы переключить пользователя на рабочий инструмент, но не держать
    # ошибку в памяти надолго.
    ERROR_TTL_S = 20

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
                    self._data[key] = (time.time() + self.ERROR_TTL_S, exc)
            raise
        with self._lock:
            self._results[key] = value
            ev.set()
            self._inflight.pop(key, None)
            self._data[key] = (time.time() + ttl, value)
        return value, False


cache = QuoteCache()

BYBIT_INTERVAL = {  # канон приложения -> Bybit
    "1m": "1", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "1d": "D", "1w": "W",
}
BINANCE_INTERVAL = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1d", "1w": "1w",
}
# TradFi (Yahoo Finance chart API): интервалы эндпоинта + шаг в секундах.
# Внутридневные интервалы доступны для истории ~60 дней; D/W/M — годы истории.
YAHOO_INTERVAL = {
    "1m": ("1m", 60), "5m": ("5m", 300), "15m": ("15m", 900),
    "30m": ("30m", 1800), "30": ("30m", 1800),
    "1h": ("60m", 3600), "60": ("60m", 3600),
    "2h": ("2h", 7200), "120": ("2h", 7200),
    "4h": ("4h", 14400), "240": ("4h", 14400),
    "1d": ("1d", 86400), "d": ("1d", 86400), "D": ("1d", 86400),
    "1w": ("1wk", 604800), "w": ("1wk", 604800), "W": ("1wk", 604800),
    "1mo": ("1mo", 2592000), "m": ("1mo", 2592000), "M": ("1mo", 2592000),
}
# Максимальное окно range по тирам Yahoo: 1m — 7 дней (в пределах дня),
# остальные внутридневные — до 60 дней; недельные/месячные фильтруются по to.
YAHOO_MAX_RANGE_S = {"1m": 7 * 86400}


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


def _normalize_yahoo_klines(raw: Any) -> list[dict]:
    """Yahoo v8/finance/chart -> канон Kline[] (хронологический порядок).

    Ответ: {chart:{result:[{timestamp:[секунды], indicators:{quote:[{open,
    high,low,close,volume}]}}]}}. null-бары (нерабочие минуты/гэпы) отбрасываем.
    """
    try:
        result = raw["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=404, detail="no data for symbol")
    if not isinstance(result, dict):
        raise HTTPException(status_code=404, detail="no data for symbol")
    ts = result.get("timestamp") or []
    try:
        q = result["indicators"]["quote"][0]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=404, detail="empty candle series")
    out = []
    for i in range(len(ts)):
        try:
            o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
            if None in (o, h, l, c):
                continue  # пустые бары вне сессии
            v = q.get("volume") or []
            vol = float(v[i]) if i < len(v) and v[i] is not None else 0.0
            out.append({
                "openTime": int(ts[i]) * 1000,
                "open": float(o), "high": float(h),
                "low": float(l), "close": float(c), "volume": vol,
            })
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    if not out:
        raise HTTPException(status_code=404, detail="empty candle series")
    return out


def _yahoo_get(path: str, params: dict) -> Any:
    """GET к Yahoo Finance chart API (без ключа) с троттлингом и UA-заголовком."""
    _yahoo_throttle()
    url = f"{ALLOWED_EXCHANGES['yahoo']}{path}"
    host = url.split("/")[2].lower()
    if host not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="host not allowed")
    try:
        r = httpx.get(url, params=params, timeout=8.0,
                      headers={"User-Agent": YAHOO_USER_AGENT,
                               "Accept": "application/json,text/plain,*/*"})
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="yahoo rate limited")
        r.raise_for_status()
        body = r.json()
        # Chart API может вернуть 200 с error-телом (неизвестный тикер)
        if isinstance(body, dict) and body.get("chart", {}).get("error"):
            raise HTTPException(status_code=404, detail="unknown symbol")
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
    iv = interval.lower()  # канон для кэша/проверок; YAHOO_INTERVAL содержит и 'D'/'W'/'M'
    if exchange == "yahoo":
        if not is_stock:
            raise HTTPException(status_code=400, detail="yahoo requires TICKER:STOCK")
        if iv not in YAHOO_INTERVAL:
            raise HTTPException(status_code=400, detail="bad interval")
    elif iv not in BYBIT_INTERVAL:
        raise HTTPException(status_code=400, detail="bad interval")
    if exchange not in ALLOWED_EXCHANGES:
        raise HTTPException(status_code=400, detail="unknown exchange")

    key = f"k:{exchange}:{symbol}:{iv}:{limit}"

    def fetch():
        if exchange == "yahoo":
            base = symbol.split(":")[0]
            yv, step_s = YAHOO_INTERVAL[iv]
            # Окно считаем по шагу бара с запасом на нерабочие дни/часы:
            # внутридневные — бары*шаг (с ограничением max range тира),
            # D/W/M — календарные дни на бар.
            now = int(time.time())
            window = step_s * (limit + 8)
            max_range = YAHOO_MAX_RANGE_S.get(yv)
            if max_range:
                window = min(window, max_range)
            params = {"symbol": base, "interval": yv,
                      "range": f"{max(1, window // 86400)}d" if window >= 86400 else "1d"}
            if yv in ("1wk", "1mo"):
                # недельные/месячные за range-окном не гарантированы — просим from/to
                params = {"symbol": base, "interval": yv,
                          "period1": str(now - window), "period2": str(now)}
            data = _yahoo_get("/v8/finance/chart/" + urllib.parse.quote(base), params)
            return _normalize_yahoo_klines(data)
        if exchange == "bybit":
            data = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/v5/market/kline", {
                "category": "spot", "symbol": symbol,
                "interval": BYBIT_INTERVAL[iv], "limit": limit})
            return _normalize_bybit_klines(data)
        data = _http_get(f"{ALLOWED_EXCHANGES[exchange]}/api/v3/klines", {
            "symbol": symbol, "interval": BINANCE_INTERVAL[iv], "limit": limit})
        return _normalize_binance_klines(data)

    value, from_cache = cache.get_or_fetch(key, cache.kline_ttl(iv), fetch, force=_t is not None)
    if exchange == "yahoo" and isinstance(value, list) and len(value) > limit:
        value = value[-limit:]  # окно range даёт запас сверху — режем по limit
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
        if exchange == "yahoo":
            # Chart API meta: regularMarketPrice / previousClose / change%.
            base = symbol.split(":")[0]
            body = _yahoo_get(f"/v8/finance/chart/{urllib.parse.quote(base)}",
                              {"symbol": base, "interval": "1d", "range": "5d"})
            try:
                meta = body["chart"]["result"][0]["meta"]
            except (KeyError, IndexError, TypeError):
                raise HTTPException(status_code=404, detail="unknown symbol")
            try:
                last_f = float(meta.get("regularMarketPrice"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=404, detail="unknown symbol")
            if last_f <= 0:
                raise HTTPException(status_code=404, detail="unknown symbol")
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            try:
                prev_f = float(prev) if prev is not None else 0.0
            except (TypeError, ValueError):
                prev_f = 0.0
            # regularMarketChangePercent у Yahoo приходит в процентах (1.477 => +1.477%)
            pct_raw = meta.get("regularMarketChangePercent")
            try:
                pct = float(pct_raw) if pct_raw is not None else None
            except (TypeError, ValueError):
                pct = None
            if pct is None:
                pct = ((last_f - prev_f) / prev_f * 100) if prev_f > 0 else 0.0
            change = last_f - prev_f if prev_f > 0 else 0.0
            return {"lastPrice": last_f,
                    "priceChange": round(change, 8),
                    "priceChangePercent": round(pct, 4)}
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
