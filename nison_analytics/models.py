"""Доменные модели журнала сделок."""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


class TradeSide(str, enum.Enum):
    """Направление позиции."""

    LONG = "long"
    SHORT = "short"

    @property
    def label(self) -> str:
        return "Длинная" if self is TradeSide.LONG else "Короткая"


class TradeStatus(str, enum.Enum):
    """Статус сделки в журнале."""

    OPEN = "open"
    CLOSED = "closed"
    CANCELLED = "cancelled"

    @property
    def label(self) -> str:
        return {
            TradeStatus.OPEN: "Открыта",
            TradeStatus.CLOSED: "Закрыта",
            TradeStatus.CANCELLED: "Отменена",
        }[self]


#: Статусы, участвующие в расчёте метрик эффективности.
PERFORMED_STATUSES = (TradeStatus.CLOSED,)


@dataclass(frozen=True)
class Trade:
    """Одна запись журнала сделок трейдера.

    P&L считается в денежном выражении по закрытию позиции;
    ``commission`` — суммарная комиссия по сделке.
    """

    symbol: str
    side: TradeSide
    entry_price: float
    qty: float
    entry_time: datetime
    status: TradeStatus = TradeStatus.OPEN
    exit_price: Optional[float] = None
    exit_time: Optional[datetime] = None
    commission: float = 0.0
    tags: tuple[str, ...] = ()
    note: str = ""
    strategy: str = "default"

    def __post_init__(self) -> None:
        if self.entry_price <= 0:
            raise ValueError(f"entry_price должен быть > 0, получено {self.entry_price}")
        if self.qty <= 0:
            raise ValueError(f"qty должен быть > 0, получено {self.qty}")
        if self.status is TradeStatus.CLOSED:
            if self.exit_price is None or self.exit_time is None:
                raise ValueError("Для закрытой сделки нужны exit_price и exit_time")
            if self.exit_price <= 0:
                raise ValueError(f"exit_price должен быть > 0, получено {self.exit_price}")
            if self.exit_time < self.entry_time:
                raise ValueError("exit_time не может быть раньше entry_time")

    # ------------------------------------------------------------------ #
    # Производные величины
    # ------------------------------------------------------------------ #
    @property
    def direction(self) -> int:
        """+1 для лонга, -1 для шорта."""
        return 1 if self.side is TradeSide.LONG else -1

    @property
    def gross_pnl(self) -> Optional[float]:
        """P&L до вычета комиссии (None, если позиция ещё открыта)."""
        if self.exit_price is None:
            return None
        return (self.exit_price - self.entry_price) * self.direction * self.qty

    @property
    def net_pnl(self) -> Optional[float]:
        """Чистый P&L за вычетом комиссии."""
        gross = self.gross_pnl
        return None if gross is None else gross - self.commission

    @property
    def return_pct(self) -> Optional[float]:
        """Доходность сделки в процентах от объёма входа."""
        gross = self.gross_pnl
        if gross is None:
            return None
        notional = self.entry_price * self.qty
        return gross / notional * 100.0 if notional else None

    @property
    def holding_seconds(self) -> Optional[float]:
        """Время удержания позиции в секундах."""
        if self.exit_time is None:
            return None
        return (self.exit_time - self.entry_time).total_seconds()

    @property
    def is_closed(self) -> bool:
        return self.status is TradeStatus.CLOSED

    @property
    def is_winner(self) -> bool:
        """Сделка в плюсе по чистому результату."""
        pnl = self.net_pnl
        return pnl is not None and pnl > 0

    def as_dict(self) -> dict:
        """Сериализация для DataFrame / CSV-экспорта."""
        return {
            "symbol": self.symbol,
            "side": self.side.value,
            "strategy": self.strategy,
            "tags": ";".join(self.tags),
            "entry_time": self.entry_time.isoformat(),
            "entry_price": self.entry_price,
            "qty": self.qty,
            "exit_time": self.exit_time.isoformat() if self.exit_time else "",
            "exit_price": self.exit_price if self.exit_price is not None else "",
            "status": self.status.value,
            "commission": self.commission,
            "gross_pnl": self.gross_pnl if self.gross_pnl is not None else "",
            "net_pnl": self.net_pnl if self.net_pnl is not None else "",
            "return_pct": self.return_pct if self.return_pct is not None else "",
            "holding_hours": (
                round(self.holding_seconds / 3600.0, 3)
                if self.holding_seconds is not None
                else ""
            ),
            "note": self.note,
        }


def utcnow() -> datetime:
    """Текущее время в UTC (для значений по умолчанию и тестов)."""
    return datetime.now(timezone.utc)
