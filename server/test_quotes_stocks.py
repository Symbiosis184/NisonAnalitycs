"""Регрессии двухконтурной загрузки акций Cboe + Twelve Data."""
import os
import unittest
import calendar
from datetime import datetime
from unittest.mock import patch

os.environ.setdefault("KAIRI_QUOTES_DB", "/tmp/kairi-stock-provider-tests.db")

from fastapi import HTTPException
from server import quotes_server as quotes


class StockProviderTests(unittest.TestCase):
    def setUp(self):
        quotes.cache = quotes.QuoteCache()

    def test_cboe_daily_appends_latest_regular_session(self):
        history = {"data": [{
            "date": "2026-11-05", "open": 100, "high": 103,
            "low": 99, "close": 102, "volume": 1000,
        }]}
        quote = {"data": {
            "symbol": "AAPL", "last_trade_time": "2026-11-06T15:59:59",
            "open": 102, "high": 105, "low": 101, "close": 104,
            "current_price": 104.5, "volume": 2000,
        }}

        def fake_get(url, _params):
            return quote if "/quotes/" in url else history

        with patch.object(quotes, "_http_get", side_effect=fake_get):
            bars = quotes._fetch_cboe_daily("AAPL")

        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[-1]["close"], 104)  # не after-hours current_price
        self.assertEqual(bars[-1]["volume"], 2000)
        self.assertEqual(
            bars[-1]["openTime"],
            calendar.timegm(datetime(2026, 11, 6).timetuple()) * 1000,
        )

    def test_cboe_intraday_aggregates_ohlcv_by_session(self):
        raw = {"data": [
            {"datetime": "2026-11-06T09:31:00",
             "price": {"open": 100, "high": 102, "low": 99, "close": 101},
             "volume": {"stock_volume": 100}},
            {"datetime": "2026-11-06T09:32:00",
             "price": {"open": 101, "high": 103, "low": 100, "close": 102},
             "volume": {"stock_volume": 200}},
            {"datetime": "2026-11-06T09:36:00",
             "price": {"open": 102, "high": 104, "low": 101, "close": 103},
             "volume": {"stock_volume": 300}},
        ]}
        bars = quotes._normalize_cboe_intraday(raw, "5")
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]["open"], 100)
        self.assertEqual(bars[0]["high"], 103)
        self.assertEqual(bars[0]["low"], 99)
        self.assertEqual(bars[0]["close"], 102)
        self.assertEqual(bars[0]["volume"], 300)
        expected = int(datetime(2026, 11, 6, 9, 30, tzinfo=quotes.NY_TZ).timestamp() * 1000)
        self.assertEqual(bars[0]["openTime"], expected)

    def test_daily_falls_back_to_twelvedata(self):
        fallback = [{"openTime": 1, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 3}]
        with patch.object(quotes, "_fetch_cboe_daily", side_effect=HTTPException(502)), \
                patch.object(quotes, "_td_stock_klines", return_value=fallback) as reserve:
            got = quotes._fetch_stock_klines("AAPL", "d", 250)
        self.assertEqual(got, fallback)
        reserve.assert_called_once_with("AAPL", "d", 250)

    def test_intraday_falls_back_to_cboe_session(self):
        raw = {"data": [{"datetime": "2026-11-06T09:31:00",
                         "price": {"open": 100, "high": 102, "low": 99, "close": 101},
                         "volume": {"stock_volume": 100}}]}
        with patch.object(quotes, "_td_stock_klines", side_effect=HTTPException(429)), \
                patch.object(quotes, "_http_get", return_value=raw):
            got = quotes._fetch_stock_klines("AAPL", "5", 250)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["close"], 101)

    def test_stock_route_returns_canonical_limited_series(self):
        rows = [{"openTime": i, "open": 10, "high": 12, "low": 9,
                 "close": 11, "volume": 100} for i in range(300)]
        with patch.object(quotes, "require_key", return_value={"role": "user"}), \
                patch.object(quotes, "_fetch_stock_klines", return_value=rows) as source:
            response = quotes.quotes_klines(
                symbol="AAPL:STOCK", interval="d", limit=250,
                exchange="stocks", _t=None, x_kairi_key="token",
            )
        self.assertEqual(len(response["data"]), 250)
        self.assertEqual(response["data"][0]["openTime"], 50)
        self.assertEqual(response["exchange"], "stocks")
        source.assert_called_once_with("AAPL", "d", 250)

    def test_weekly_and_monthly_use_daily_series(self):
        daily = [
            {"openTime": int(datetime(2026, 11, 5).timestamp() * 1000),
             "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
            {"openTime": int(datetime(2026, 11, 6).timestamp() * 1000),
             "open": 11, "high": 13, "low": 10, "close": 12, "volume": 200},
        ]
        weekly = quotes._aggregate_stock_daily(daily, "w")
        monthly = quotes._aggregate_stock_daily(daily, "m")
        for row in (weekly[0], monthly[0]):
            self.assertEqual(row["open"], 10)
            self.assertEqual(row["high"], 13)
            self.assertEqual(row["low"], 9)
            self.assertEqual(row["close"], 12)
            self.assertEqual(row["volume"], 300)


if __name__ == "__main__":
    unittest.main()
