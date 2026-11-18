"""Пакет аналитики трейдера (NisonAnalytics).

Модули:
    models   — доменные модели и словари статусов;
    metrics  — расчёт метрик эффективности торговой системы;
    reports  — агрегация данных для дашборда и экспорт;
    sample_data — генерация демо-данных.
"""

from nison_analytics.models import Trade, TradeSide, TradeStatus
from nison_analytics.metrics import compute_metrics, MetricSnapshot

__all__ = [
    "Trade",
    "TradeSide",
    "TradeStatus",
    "compute_metrics",
    "MetricSnapshot",
]

__version__ = "0.1.0"
