"""Тесты расчёта метрик."""

from datetime import datetime, timedelta, timezone

import pytest

from nison_analytics.metrics import (
    compute_metrics,
    equity_curve,
    group_by,
    max_drawdown,
    monthly_pnl,
)
from nison_analytics.models import Trade, TradeSide, TradeStatus


T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def trade(pnl_move: float, day: int = 1, commission: float = 0.0,
          side=TradeSide.LONG, strategy: str = "default", symbol: str = "AAA") -> Trade:
    """Закрытая лонг-сделка с заданным изменением цены на 10 единиц."""
    entry = 100.0
    exit_ = entry * (1 + pnl_move * side_direction(side))
    return Trade(
        symbol=symbol,
        side=side,
        entry_price=entry,
        qty=10.0,
        entry_time=T0 + timedelta(days=day),
        status=TradeStatus.CLOSED,
        exit_price=exit_,
        exit_time=T0 + timedelta(days=day, hours=2),
        commission=commission,
        strategy=strategy,
    )


def side_direction(side):
    return 1 if side is TradeSide.LONG else -1


def test_empty_input():
    m = compute_metrics([])
    assert m.total_trades == 0
    assert m.win_rate == 0.0
    assert m.profit_factor is None


def test_basic_counts_and_win_rate():
    trades = [trade(0.1, 1), trade(-0.05, 2), trade(0.2, 3)]
    m = compute_metrics(trades)
    assert m.total_trades == 3
    assert m.winners == 2 and m.losers == 1
    assert m.win_rate == pytest.approx(2 / 3 * 100)
    assert m.total_net_pnl == pytest.approx((0.1 - 0.05 + 0.2) * 1000)


def test_commission_reduces_pnl():
    m = compute_metrics([trade(0.1, 1, commission=50)])
    assert m.total_net_pnl == pytest.approx(100 - 50)
    assert m.total_commission == 50


def test_profit_factor_and_expectancy():
    trades = [trade(0.1, 1), trade(0.1, 2), trade(-0.1, 3)]
    m = compute_metrics(trades)
    # цена входа 100, объём 10 -> изменение на 10% = 100 ден. единиц за сделку
    assert m.gross_profit == pytest.approx(200)
    assert m.gross_loss == pytest.approx(100)
    assert m.profit_factor == pytest.approx(2.0)
    assert m.expectancy == pytest.approx(100 / 3)


def test_all_winners_profit_factor_inf():
    m = compute_metrics([trade(0.1, 1), trade(0.2, 2)])
    assert m.profit_factor == float("inf")
    assert m.avg_loss == 0.0
    assert m.payoff_ratio is None


def test_equity_curve_and_drawdown():
    trades = [trade(0.1, 1), trade(-0.15, 2), trade(0.05, 3)]
    curve = equity_curve(trades)
    assert curve == [pytest.approx(100), pytest.approx(-50), pytest.approx(0)]
    dd_abs, dd_pct = max_drawdown(curve)
    assert dd_abs == pytest.approx(150)  # пик 100 -> дно -50


def test_max_drawdown_empty():
    assert max_drawdown([]) == (0.0, None)


def test_group_by_strategy():
    trades = [trade(0.1, 1, strategy="a"), trade(-0.1, 2, strategy="b")]
    g = group_by(trades, "strategy")
    assert set(g) == {"a", "b"}
    assert g["a"].win_rate == 100.0
    assert g["b"].win_rate == 0.0


def test_monthly_pnl():
    trades = [trade(0.1, 1), trade(-0.05, 32)]  # январь и февраль
    mp = monthly_pnl(trades)
    assert mp == {"2026-01": pytest.approx(100), "2026-02": pytest.approx(-50)}


def test_open_trades_excluded():
    open_t = Trade(
        symbol="AAA", side=TradeSide.LONG, entry_price=100, qty=1,
        entry_time=T0, status=TradeStatus.OPEN,
    )
    m = compute_metrics([open_t, trade(0.1, 1)])
    assert m.total_trades == 1
