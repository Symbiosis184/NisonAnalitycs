"""Агрегация журнала сделок в DataFrame и экспорт."""

from __future__ import annotations

from typing import Iterable, Optional

import pandas as pd

from nison_analytics.models import Trade


def trades_to_frame(trades: Iterable[Trade]) -> pd.DataFrame:
    """Журнал сделок в виде таблицы со служебными колонками."""
    rows = [t.as_dict() for t in trades]
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["entry_time"] = pd.to_datetime(df["entry_time"], utc=True)
    df["exit_time"] = pd.to_datetime(
        df["exit_time"].replace("", pd.NA), utc=True, errors="coerce"
    )
    for col in ("entry_price", "exit_price", "qty", "commission",
                "gross_pnl", "net_pnl", "return_pct", "holding_hours"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def load_trades_csv(path_or_buffer, tz: Optional[str] = None) -> list[Trade]:
    """Загрузить журнал из CSV (экспорт ``trades_to_frame`` или совместимый).

    Обязательные колонки: symbol, side, entry_price, qty, entry_time.
    Необязательные: status, exit_price, exit_time, commission, strategy,
    tags, note.
    """
    from nison_analytics.models import TradeSide, TradeStatus

    df = pd.read_csv(path_or_buffer)
    required = {"symbol", "side", "entry_price", "qty", "entry_time"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"В CSV нет обязательных колонок: {sorted(missing)}")

    def _opt(row, name, cast=str):
        value = row.get(name)
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return cast(value)

    trades: list[Trade] = []
    for _, raw in df.iterrows():
        row = raw.to_dict()
        entry_time = pd.to_datetime(row["entry_time"], utc=True)
        exit_time = _opt(row, "exit_time", lambda v: pd.to_datetime(v, utc=True))
        exit_price = _opt(row, "exit_price", float)
        status_raw = _opt(row, "status", str) or (
            "closed" if exit_price is not None else "open"
        )
        tags_raw = _opt(row, "tags", str)
        trades.append(
            Trade(
                symbol=str(row["symbol"]).strip().upper(),
                side=TradeSide(str(row["side"]).strip().lower()),
                entry_price=float(row["entry_price"]),
                qty=float(row["qty"]),
                entry_time=entry_time.to_pydatetime(),
                status=TradeStatus(status_raw.strip().lower()),
                exit_price=exit_price,
                exit_time=exit_time.to_pydatetime() if exit_time is not None else None,
                commission=float(_opt(row, "commission", float) or 0.0),
                strategy=_opt(row, "strategy", str) or "default",
                tags=tuple(t for t in (tags_raw or "").split(";") if t),
                note=_opt(row, "note", str) or "",
            )
        )
    return trades


def frame_for_dashboard(trades: Iterable[Trade]) -> pd.DataFrame:
    """Таблица для виджетов дашборда (только закрытые + открытые позиции)."""
    df = trades_to_frame(trades)
    if df.empty:
        return df
    df = df.sort_values("entry_time").reset_index(drop=True)
    return df


def export_trades_csv(trades: Iterable[Trade]) -> str:
    """CSV-строка журнала для скачивания с дашборда."""
    df = trades_to_frame(trades)
    return df.to_csv(index=False) if not df.empty else ""
