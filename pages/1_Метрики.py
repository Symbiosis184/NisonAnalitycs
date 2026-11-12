"""Страница «Метрики» — подробные показатели торговой системы."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from nison_analytics.metrics import compute_metrics, monthly_pnl
from nison_analytics.sample_data import generate_sample_trades

st.set_page_config(page_title="Метрики — NisonAnalytics", page_icon="🧮")
st.title("🧮 Метрики торговой системы")

trades = generate_sample_trades()
m = compute_metrics(trades)

left, right = st.columns(2)

with left:
    st.subheader("Результативность")
    df_perf = pd.DataFrame(
        {
            "Показатель": [
                "Всего закрытых сделок",
                "Прибыльные / Убыточные / В ноль",
                "Win Rate, %",
                "Чистый P&L",
                "Средний выигрыш",
                "Средний убыток",
                "Payoff Ratio",
                "Expectancy (на сделку)",
            ],
            "Значение": [
                m.total_trades,
                f"{m.winners} / {m.losers} / {m.breakeven}",
                round(m.win_rate, 1),
                round(m.total_net_pnl, 2),
                round(m.avg_win, 2),
                round(m.avg_loss, 2),
                round(m.payoff_ratio, 2) if m.payoff_ratio else None,
                round(m.expectancy, 2),
            ],
        }
    )
    st.dataframe(df_perf, hide_index=True, use_container_width=True)

with right:
    st.subheader("Риск и издержки")
    df_risk = pd.DataFrame(
        {
            "Показатель": [
                "Profit Factor",
                "Макс. просадка",
                "Макс. просадка, %",
                "Лучшая сделка",
                "Худшая сделка",
                "Среднее время в позиции, ч",
                "Комиссии всего",
            ],
            "Значение": [
                round(m.profit_factor, 2) if m.profit_factor not in (None, float("inf")) else m.profit_factor,
                round(m.max_drawdown, 2),
                round(m.max_drawdown_pct, 1) if m.max_drawdown_pct else None,
                round(m.best_trade, 2),
                round(m.worst_trade, 2),
                round(m.avg_holding_hours, 1) if m.avg_holding_hours else None,
                round(m.total_commission, 2),
            ],
        }
    )
    st.dataframe(df_risk, hide_index=True, use_container_width=True)

st.subheader("P&L по месяцам")
mp = monthly_pnl(trades)
df_m = pd.DataFrame({"Месяц": list(mp), "P&L": list(mp.values())})
fig = px.bar(
    df_m,
    x="Месяц",
    y="P&L",
    color=df_m["P&L"] >= 0,
    color_discrete_map={True: "#26a69a", False: "#ef5350"},
    labels={"color": "", "P&L": "P&L"},
)
fig.update_layout(height=380)
st.plotly_chart(fig, use_container_width=True)
