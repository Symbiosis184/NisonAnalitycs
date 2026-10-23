// Настройки риск-менеджмента пользователя (аудит №10).
// planPosition() существовал как «мёртвый код» — здесь он подключается к UI:
// капитал и риск на сделку хранятся в localStorage, сигналы получают план позиции.
// Значения проходят валидацию: повреждённые/чужие данные не должны ломать расчёт.

import type { RiskSettings } from '../api/types';

const STORAGE_KEY = 'niso…sks_v1';

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  capitalUsd: 10_000,
  riskPct: 0.01, // правило 1% риска
};

/** Границы допустимых значений (защита от опечаток, убивающих sizing) */
export const RISK_LIMITS = {
  minCapital: 100,
  maxCapital: 100_000_000,
  minRiskPct: 0.001, // 0.1%
  maxRiskPct: 0.05,  // 5% — агрессивный максимум
} as const;

export function sanitizeRiskSettings(raw: unknown): RiskSettings {
  const out = { ...DEFAULT_RISK_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const cap = Number(r.capitalUsd);
    const risk = Number(r.riskPct);
    if (Number.isFinite(cap) && cap >= RISK_LIMITS.minCapital && cap <= RISK_LIMITS.maxCapital) {
      out.capitalUsd = cap;
    }
    if (Number.isFinite(risk) && risk >= RISK_LIMITS.minRiskPct && risk <= RISK_LIMITS.maxRiskPct) {
      out.riskPct = risk;
    }
  }
  return out;
}

export function loadRiskSettings(): RiskSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_RISK_SETTINGS };
    return sanitizeRiskSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RISK_SETTINGS };
  }
}

export function saveRiskSettings(s: RiskSettings): RiskSettings {
  const clean = sanitizeRiskSettings(s);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // квота/приватный режим — настройки останутся только в памяти сессии
  }
  return clean;
}
