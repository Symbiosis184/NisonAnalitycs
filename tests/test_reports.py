"""Тесты CSV-экспорта/импорта журнала сделок."""

import io

import pytest

from nison_analytics.models import Trade, TradeSide, TradeStatus
from nison_analytics.reports import export_trades_csv, load_trades_csv, trades_to_frame
from nison_analytics.sample_data import generate_sample_trades


def test_export_import_roundtrip():
    trades = generate_sample_trades(n=25, seed=7)
    csv = export_trades_csv(trades)
    restored = load_trades_csv(io.StringIO(csv))
    assert len(restored) == len(trades)
    for src, dst in zip(trades, restored):
        assert dst.symbol == src.symbol
        assert dst.side is src.side
        assert dst.status is src.status
        assert dst.entry_price == pytest.approx(src.entry_price)
        assert dst.qty == pytest.approx(src.qty)
        if src.is_closed:
            assert dst.net_pnl == pytest.approx(src.net_pnl)


def test_missing_columns_raise():
    with pytest.raises(ValueError, match="обязательных"):
        load_trades_csv(io.StringIO("a,b\n1,2\n"))


def test_minimal_csv_defaults_to_open():
    csv = "symbol,side,entry_price,qty,entry_time\nAAA,long,10,1,2026-01-01T00:00:00+00:00\n"
    trades = load_trades_csv(io.StringIO(csv))
    assert trades[0].status is TradeStatus.OPEN
    assert trades[0].gross_pnl is None


def test_frame_columns_and_types():
    df = trades_to_frame(generate_sample_trades(n=5))
    assert {"symbol", "net_pnl", "return_pct", "holding_hours"} <= set(df.columns)
    assert len(df) == 5
