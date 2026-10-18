"""Генерация детерминированных демо-данных для дашборда.

Используется, когда пользователь ещё не загрузил собственный журнал
сделок. Случайность — с фиксированным seed, чтобы вид дашборда был
воспроизводимым.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from nison_analytics.models import Trade, TradeSide, TradeStatus

SYMBOLS = ("SBER", "GAZP", "LKOH", "VTBR", "YNDX", "TSLA", "AAPL")
STRATEGIES = ("breakout", "mean_reversion", "trend_following")


def generate_sample_trades(n: int = 120, seed: int = 42) -> list[Trade]:
    """Вернуть список из ``n`` синтетических сделок за последний год."""
    rng = random.Random(seed)
    now = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)
    trades: list[Trade] = []

    for i in range(n):
        symbol = rng.choice(SYMBOLS)
        side = rng.choice([TradeSide.LONG, TradeSide.SHORT])
        strategy = rng.choice(STRATEGIES)
        base_price = rng.uniform(50.0, 400.0)
        qty = round(rng.uniform(1.0, 100.0), 2)
        entry_time = now - timedelta(
            days=rng.randint(1, 365), hours=rng.randint(0, 23), minutes=rng.randint(0, 59)
        )
        hold = timedelta(hours=rng.randint(1, 96))
        commission = round(base_price * qty * 0.0006, 2)

        # ~55% прибыльных сделок со смещением в пользу trend_following
        bias = {"trend_following": 0.10, "breakout": 0.0, "mean_reversion": -0.05}[strategy]
        is_win = rng.random() < (0.55 + bias)
        magnitude = abs(rng.gauss(1.5, 1.2)) / 100.0  # % изменения цены
        move = magnitude if is_win else -magnitude * rng.uniform(0.4, 1.1)
        # для шорта прибыль получается при падении цены
        if side is TradeSide.LONG:
            exit_price = round(base_price * (1 + move), 4)
        else:
            exit_price = round(base_price * (1 - move), 4)

        status = TradeStatus.CLOSED
        # несколько открытых позиций на конец периода
        if i >= n - 4 and rng.random() < 0.6:
            status = TradeStatus.OPEN
            exit_price = None
            exit_time = None
        else:
            exit_time = entry_time + hold

        tags = tuple(rng.sample(["intraday", "swing", "news", "earnings"], k=rng.randint(0, 2)))
        trades.append(
            Trade(
                symbol=symbol,
                side=side,
                entry_price=round(base_price, 4),
                qty=qty,
                entry_time=entry_time,
                status=status,
                exit_price=exit_price,
                exit_time=exit_time,
                commission=commission if status is TradeStatus.CLOSED else commission / 2,
                tags=tags,
                strategy=strategy,
                note="",
            )
        )
    return trades
