"""Тесты доменной модели Trade."""

from datetime import datetime, timedelta, timezone

import pytest

from nison_analytics.models import Trade, TradeSide, TradeStatus


def make_trade(**overrides) -> Trade:
    base = dict(
        symbol="SBER",
        side=TradeSide.LONG,
        entry_price=100.0,
        qty=10.0,
        entry_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        status=TradeStatus.CLOSED,
        exit_price=110.0,
        exit_time=datetime(2026, 1, 2, tzinfo=timezone.utc),
        commission=5.0,
    )
    base.update(overrides)
    return Trade(**base)


class TestValidation:
    def test_positive_entry_price_required(self):
        with pytest.raises(ValueError):
            make_trade(entry_price=0)
        with pytest.raises(ValueError):
            make_trade(qty=-1)

    def test_closed_requires_exit(self):
        with pytest.raises(ValueError):
            make_trade(exit_price=None)

    def test_exit_before_entry_rejected(self):
        with pytest.raises(ValueError):
            make_trade(exit_time=datetime(2025, 12, 31, tzinfo=timezone.utc))


class TestPnl:
    def test_long_profit(self):
        t = make_trade()
        assert t.gross_pnl == pytest.approx(100.0)
        assert t.net_pnl == pytest.approx(95.0)
        assert t.return_pct == pytest.approx(10.0)

    def test_short_profit_on_price_drop(self):
        t = make_trade(side=TradeSide.SHORT, exit_price=90.0)
        assert t.gross_pnl == pytest.approx(100.0)
        assert t.is_winner

    def test_open_trade_has_no_pnl(self):
        t = make_trade(status=TradeStatus.OPEN, exit_price=None, exit_time=None)
        assert t.gross_pnl is None
        assert t.net_pnl is None
        assert not t.is_winner

    def test_holding_seconds(self):
        t = make_trade()
        assert t.holding_seconds == pytest.approx(timedelta(days=1).total_seconds())

    def test_as_dict_roundtrip_keys(self):
        d = make_trade(tags=("a", "b")).as_dict()
        assert d["tags"] == "a;b"
        assert d["net_pnl"] == pytest.approx(95.0)
