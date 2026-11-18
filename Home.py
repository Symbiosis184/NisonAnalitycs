"""NisonAnalytics — Дашборд трейдера (точка входа Streamlit).

Запуск:
    streamlit run Home.py
"""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from nison_analytics.metrics import (
    compute_metrics,
    closed_trades,
    equity_curve,
    group_by,
)
from nison_analytics.reports import export_trades_csv, frame_for_dashboard, load_trades_csv
from nison_analytics.sample_data import generate_sample_trades

st.set_page_config(
    page_title="NisonAnalytics — Дашборд трейдера",
    page_icon="📈",
    layout="wide",
)


# ---------------------------------------------------------------------- #
# Загрузка данных (демо или CSV пользователя) с кэшированием
# ---------------------------------------------------------------------- #
@st.cache_data(show_spinner="Загружаем журнал сделок…")
def get_trades(source: str, uploaded=None):
    if source == "CSV" and uploaded is not None:
        return load_trades_csv(uploaded)
    return generate_sample_trades()


with st.sidebar:
    st.header("Источник данных")
    source = st.radio("Журнал сделок", ["Демо-данные", "CSV"], horizontal=True)
    uploaded = None
    if source == "CSV":
        uploaded = st.file_uploader("Загрузите CSV журнала", type=["csv"])
        if uploaded is None:
            st.info("Файл не выбран — показываем демо-данные.")
            source = "Демо-данные"

    st.divider()
    st.caption("NisonAnalytics v0.1.0 — дашборд трейдера")

trades = get_trades(source, uploaded)
metrics = compute_metrics(trades)
frame = frame_for_dashboard(trades)

# ---------------------------------------------------------------------- #
# Заголовок и KPI
# ---------------------------------------------------------------------- #
st.title("📈 NisonAnalytics — Дашборд трейдера")
st.caption(
    f"Период: "
    f"{metrics.first_exit_time:%d.%m.%Y} — {metrics.last_exit_time:%d.%m.%Y}"
    if metrics.first_exit_time
    else "Нет закрытых сделок за период."
)

k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("Чистый P&L", f"{metrics.total_net_pnl:,.0f}")
k2.metric("Win Rate", f"{metrics.win_rate:.1f}%")
pf = "∞" if metrics.profit_factor == float("inf") else (
    f"{metrics.profit_factor:.2f}" if metrics.profit_factor is not None else "—"
)
k3.metric("Profit Factor", pf)
dd_pct = f" ({metrics.max_drawdown_pct:.1f}%)" if metrics.max_drawdown_pct else ""
k4.metric("Макс. просадка", f"{metrics.max_drawdown:,.0f}{dd_pct}", delta=None)
k5.metric("Сделок закрыто", metrics.total_trades)

# ---------------------------------------------------------------------- #
# Кривая капитала и распределение результатов
# ---------------------------------------------------------------------- #
col_l, col_r = st.columns([2, 1])

performed = closed_trades(trades)
curve = equity_curve(performed)
times = [t.exit_time for t in performed]
with col_l:
    st.subheader("Кривая капитала")
    fig_eq = go.Figure()
    fig_eq.add_trace(
        go.Scatter(x=times, y=curve, mode="lines", name="Накопленный P&L",
                   line=dict(width=2))
    )
    fig_eq.update_layout(yaxis_title="P&L", xaxis_title="Дата закрытия",
                         margin=dict(l=10, r=10, t=30, b=10), height=380)
    st.plotly_chart(fig_eq, use_container_width=True)

with col_r:
    st.subheader("Распределение сделок")
    pnls = [t.net_pnl or 0.0 for t in performed]
    # окраска столбцов по знаку результата: прибыль/убыток
    fig_hist = go.Figure()
    wins = [p for p in pnls if p >= 0]
    losses = [p for p in pnls if p < 0]
    fig_hist.add_trace(go.Histogram(x=wins, name="Прибыльные", marker_color="#26a69a", nbinsx=20))
    fig_hist.add_trace(go.Histogram(x=losses, name="Убыточные", marker_color="#ef5350", nbinsx=20))
    fig_hist.update_layout(barmode="overlay", height=380,
                           margin=dict(l=10, r=10, t=30, b=10), legend=dict(orientation="h"))
    st.plotly_chart(fig_hist, use_container_width=True)

# ---------------------------------------------------------------------- #
# Разрезы и журнал
# ---------------------------------------------------------------------- #
tab_strat, tab_symbols, tab_log = st.tabs(["По стратегиям", "По инструментам", "Журнал сделок"])

with tab_strat:
    g = group_by(trades, "strategy")
    df_g = pd.DataFrame(
        {
            "Стратегия": list(g),
            "Сделок": [s.total_trades for s in g.values()],
            "Win Rate, %": [round(s.win_rate, 1) for s in g.values()],
            "P&L": [round(s.total_net_pnl, 2) for s in g.values()],
            "Profit Factor": [
                None if s.profit_factor is None else round(s.profit_factor, 2)
                for s in g.values()
            ],
        }
    )
    st.dataframe(df_g, hide_index=True, use_container_width=True)
    fig_bar = px.bar(df_g, x="Стратегия", y="P&L", color="P&L",
                     color_continuous_scale=["#ef5350", "#ffd54f", "#26a69a"])
    fig_bar.update_layout(height=320, margin=dict(l=10, r=10, t=10, b=10))
    st.plotly_chart(fig_bar, use_container_width=True)

with tab_symbols:
    g = group_by(trades, "symbol")
    df_g = pd.DataFrame(
        {
            "Инструмент": list(g),
            "Сделок": [s.total_trades for s in g.values()],
            "Win Rate, %": [round(s.win_rate, 1) for s in g.values()],
            "P&L": [round(s.total_net_pnl, 2) for s in g.values()],
        }
    ).sort_values("P&L", ascending=False)
    st.dataframe(df_g, hide_index=True, use_container_width=True)

with tab_log:
    st.subheader("Журнал сделок")
    only_closed = st.checkbox("Только закрытые", value=False)
    shown = frame[frame["status"] == "closed"] if only_closed else frame
    st.dataframe(shown, hide_index=True, use_container_width=True, height=420)
    st.download_button(
        "Скачать CSV",
        data=export_trades_csv(trades),
        file_name="nison_trades.csv",
        mime="text/csv",
    )
