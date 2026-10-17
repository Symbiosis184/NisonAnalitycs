"""Метрики эффективности торговой системы по журналу сделок.

Все функции чистые: принимают список ``Trade`` и возвращают структуры
данных, готовые к отображению на дашборде. Денежные значения — в той же
валюте, что и цены в журнале.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Iterable, Optional, Sequence

from nison_analytics.models import Trade, TradeStatus


# ---------------------------------------------------------------------- #
# Снимок метрик
# ---------------------------------------------------------------------- #
@dataclass(frozen=True)
class MetricSnapshot:
    """Ключевые показатели по закрытым сделкам."""

    total_trades: int = 0
    winners: int = 0
    losers: int = 0
    breakeven: int = 0
    win_rate: float = 0.0            # доля прибыльных, %
    total_net_pnl: float = 0.0
    gross_profit: float = 0.0        # сумма прибылей
    gross_loss: float = 0.0          # сумма убытков (по модулю)
    profit_factor: Optional[float] = None  # прибыль / убыток
    avg_win: float = 0.0
    avg_loss: float = 0.0
    payoff_ratio: Optional[float] = None   # средний выигрыш / средний убыток
    expectancy: float = 0.0          # мат. ожидание на сделку
    max_drawdown: float = 0.0        # максимальная просадка кривой капитала
    max_drawdown_pct: Optional[float] = None
    best_trade: float = 0.0
    worst_trade: float = 0.0
    avg_holding_hours: Optional[float] = None
    total_commission: float = 0.0
    first_exit_time: Optional[datetime] = None
    last_exit_time: Optional[datetime] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------- #
# Вспомогательные функции
# ---------------------------------------------------------------------- #
def closed_trades(trades: Iterable[Trade]) -> list[Trade]:
    """Только закрытые сделки, отсортированные по времени выхода."""
    performed = [t for t in trades if t.status in (TradeStatus.CLOSED,)]
    return sorted(performed, key=lambda t: (t.exit_time, t.entry_time))


def equity_curve(trades: Sequence[Trade], initial_capital: float = 0.0) -> list[float]:
    """Кривая капитала: накопленный чистый P&L по времени закрытия.

    При ``initial_capital == 0`` возвращается накопленный P&L
    (начинается с нуля), иначе — капитал, начинающийся с ``initial_capital``.
    """
    curve: list[float] = []
    running = initial_capital
    for trade in trades:
        pnl = trade.net_pnl or 0.0
        running += pnl
        curve.append(running)
    return curve


def max_drawdown(equity: Sequence[float]) -> tuple[float, Optional[float]]:
    """Максимальная просадка: (абсолютная, % от пика).

    Пик считается с учётом стартового уровня (0 — накопленный P&L
    стартует с нуля). Процент осмыслен только при положительном пике;
    если кривка нигде не уходила в плюс, процент равен None.
    """
    if not equity:
        return 0.0, None

    peak = 0.0
    dd_abs = 0.0
    dd_pct: Optional[float] = None

    for value in equity:
        if value > peak:
            peak = value
        drawdown = peak - value
        if drawdown > dd_abs:
            dd_abs = drawdown
        if peak > 0:
            pct = drawdown / peak * 100.0
            if dd_pct is None or pct > dd_pct:
                dd_pct = pct
    return dd_abs, dd_pct


# ---------------------------------------------------------------------- #
# Основная метрика
# ---------------------------------------------------------------------- #
def compute_metrics(trades: Iterable[Trade]) -> MetricSnapshot:
    """Рассчитать комплект метрик по списку сделок.

    Метрики считаются только по ЗАКРЫТЫМ сделкам; открытые и отменённые
    игнорируются. Пустой вход даёт пустой снимок со нулями.
    """
    performed = closed_trades(trades)
    if not performed:
        return MetricSnapshot()

    pnls = [t.net_pnl or 0.0 for t in performed]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    breakeven = len(pnls) - len(wins) - len(losses)

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))

    win_rate = len(wins) / len(pnls) * 100.0
    avg_win = gross_profit / len(wins) if wins else 0.0
    avg_loss = gross_loss / len(losses) if losses else 0.0

    profit_factor: Optional[float]
    if gross_loss > 0:
        profit_factor = gross_profit / gross_loss
    elif gross_profit > 0:
        profit_factor = math.inf
    else:
        profit_factor = None

    payoff_ratio: Optional[float] = avg_win / avg_loss if avg_loss > 0 else None

    expectancy = (gross_profit + (-gross_loss)) / len(pnls) if pnls else 0.0

    dd_abs, dd_pct = max_drawdown(equity_curve(performed))

    holdings = [t.holding_seconds for t in performed if t.holding_seconds is not None]
    avg_holding_hours = (sum(holdings) / len(holdings) / 3600.0) if holdings else None

    exit_times = [t.exit_time for t in performed if t.exit_time is not None]

    return MetricSnapshot(
        total_trades=len(pnls),
        winners=len(wins),
        losers=len(losses),
        breakeven=breakeven,
        win_rate=win_rate,
        total_net_pnl=sum(pnls),
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        profit_factor=profit_factor,
        avg_win=avg_win,
        avg_loss=-avg_loss if losses else 0.0,
        payoff_ratio=payoff_ratio,
        expectancy=expectancy,
        max_drawdown=dd_abs,
        max_drawdown_pct=dd_pct,
        best_trade=max(pnls),
        worst_trade=min(pnls),
        avg_holding_hours=avg_holding_hours,
        total_commission=sum(t.commission for t in performed),
        first_exit_time=min(exit_times) if exit_times else None,
        last_exit_time=max(exit_times) if exit_times else None,
    )


# ---------------------------------------------------------------------- #
# Агрегации для графиков
# ---------------------------------------------------------------------- #
def group_by(trades: Sequence[Trade], key: str) -> dict[str, MetricSnapshot]:
    """Метрики в разрезе измерения: symbol | side | strategy."""
    buckets: dict[str, list[Trade]] = {}
    for trade in trades:
        if key == "symbol":
            value = trade.symbol
        elif key == "side":
            value = trade.side.value
        elif key == "strategy":
            value = trade.strategy
        else:  # pragma: no cover - защита от опечаток
            raise ValueError(f"Неизвестное измерение группировки: {key!r}")
        buckets.setdefault(value, []).append(trade)
    return {name: compute_metrics(items) for name, items in sorted(buckets.items())}


def monthly_pnl(trades: Sequence[Trade]) -> dict[str, float]:
    """Суммарный чистый P&L по месяцам закрытия ('ГГГГ-ММ')."""
    result: dict[str, float] = {}
    for trade in trades:
        if trade.exit_time is None:
            continue
        month = f"{trade.exit_time.year:04d}-{trade.exit_time.month:02d}"
        result[month] = result.get(month, 0.0) + (trade.net_pnl or 0.0)
    return dict(sorted(result.items()))
