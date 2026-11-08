// Вынос из Analysis.tsx (реконструкция): секция торговых сигналов
// «Сценарии (Нисон: ожидание → подтверждение)» — аудит №10/№11: живой список
// со статусами жизненного цикла, риск-панелью и планом позиции.

import { useState } from 'react';
import { Activity, Shield, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { Icon } from '../ui/Icon';
import type { AnalysisReport, RiskSettings, SignalDTO } from '../../api/types';
import { formatPrice } from '../../utils/format';
import { STATUS_LABEL } from '../../utils/signal_lifecycle';
import { RISK_LIMITS } from '../../utils/risk_settings';
import { PricePathCard } from '../MarketContextPanels';
import { useI18n } from '../../i18n';

/** Жизненный цикл сигнала: явный статус от движка, иначе — по флагу подтверждения */
export const lifecycleOf = (s: SignalDTO) =>
  s.lifecycle_status ?? (s.confirmed ? 'confirmed' : 'pending');

export function SignalsSection({ report, riskSettings, showRiskPanel, onToggleRiskPanel, onApplyRisk }: {
  report: AnalysisReport;
  riskSettings: RiskSettings;
  showRiskPanel: boolean;
  onToggleRiskPanel: () => void;
  onApplyRisk: (capitalUsd: number, riskPct: number) => void;
}) {
  const { t, locale } = useI18n();
  const confirmedCount = report.signals.filter((s) => s.lifecycle_status === 'confirmed').length;
  const pendingCount = report.signals.filter((s) => (s.lifecycle_status ?? 'pending') === 'pending').length;
  const visibleSignals = report.signals.filter((signal) => lifecycleOf(signal) !== 'invalidated');

  return (
    <div className="panel p-6 ">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Target className="w-5 h-5 text-amber-400" />
        {t('Свечные сценарии · подтверждение')}
        <span className="text-xs text-gray-400 font-normal ml-2">
          {t('подтверждено')} {confirmedCount} · {t('ждёт')} {pendingCount} {t('из')} {report.signals.length}
        </span>
        {/* Аудит №10: редактор риск-настроек для расчёта размера позиции */}
        <button
          onClick={onToggleRiskPanel}
          className="ml-auto px-2 py-1 rounded text-xs font-medium bg-gray-800/60 text-gray-300 hover:text-white border border-gray-700/50"
        >
          {t('Риск')}: {(riskSettings.riskPct * 100).toFixed(1)}% · {riskSettings.capitalUsd.toLocaleString(locale)} $
        </button>
      </h3>
      {showRiskPanel && (
        <RiskSettingsPanel settings={riskSettings} onApply={onApplyRisk} />
      )}
      <div className="space-y-3">
        {visibleSignals.map((signal, idx: number) => (
          <SignalCard key={idx} signal={signal} riskSettings={riskSettings} />
        ))}
      </div>
    </div>
  );
}

/** Аудит №10: панель ввода капитала и риска на сделку (значения нормализуются saveRiskSettings). */
function RiskSettingsPanel({ settings, onApply }: {
  settings: RiskSettings;
  onApply: (capitalUsd: number, riskPct: number) => void;
}) {
  const { t, locale } = useI18n();
  const [capital, setCapital] = useState(String(settings.capitalUsd));
  const [risk, setRisk] = useState((settings.riskPct * 100).toFixed(1));
  return (
    <div className="mb-4 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50 flex flex-wrap items-end gap-3 text-sm overflow-x-auto">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">{t('Капитал')}, $ ({RISK_LIMITS.minCapital}–{RISK_LIMITS.maxCapital.toLocaleString(locale)})</span>
        <input
          type="number" min={RISK_LIMITS.minCapital} max={RISK_LIMITS.maxCapital} value={capital}
          onChange={(e) => setCapital(e.target.value)}
          className="w-36 px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-white font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">{t('Риск на сделку')}, % ({RISK_LIMITS.minRiskPct * 100}–{RISK_LIMITS.maxRiskPct * 100})</span>
        <input
          type="number" step="0.1" min={RISK_LIMITS.minRiskPct * 100} max={RISK_LIMITS.maxRiskPct * 100} value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="w-24 px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-white font-mono"
        />
      </label>
      <button
        onClick={() => onApply(Number(capital), Number(risk) / 100)}
        className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-xs font-medium"
      >
        {t('Применить')}
      </button>
      <span className="text-[11px] text-gray-400">{t('Планы позиций пересчитаются для всех сигналов.')}</span>
    </div>
  );
}

function SignalCard({ signal, riskSettings }: {
  signal: SignalDTO;
  riskSettings: RiskSettings;
}) {
  const { t, locale } = useI18n();
  const st = lifecycleOf(signal);
  return (
    <div
      className={`p-4 rounded-lg border ${
        signal.direction === 'long'
          ? 'bg-green-500/5 border-green-500/20'
          : 'bg-red-500/5 border-red-500/20'
      }`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {signal.direction === 'long' ? (
              <TrendingUp className="w-5 h-5 text-green-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
            <span className={`text-lg font-bold ${
              signal.direction === 'long' ? 'text-green-400' : 'text-red-400'
            }`}>
              {signal.direction === 'long' ? 'LONG' : 'SHORT'}
            </span>
          </div>
          <p className="text-sm text-gray-400">{signal.pattern}</p>
        </div>
        <div className="sm:text-right">
          <div className="text-xs text-gray-400">{t('Эвристический балл')}</div>
          <div className={`text-lg font-bold ${
            signal.quality >= 0.7 ? 'text-green-400' :
            signal.quality >= 0.5 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {(signal.quality * 100).toFixed(0)}/100
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-sm mb-3 sm:grid-cols-3 sm:gap-4">
        <div className="p-2 rounded bg-gray-800/30">
          <div className="text-xs text-gray-400 mb-1">{t('Вход')}</div>
          <div className="font-mono text-white">${formatPrice(signal.entry_price)}</div>
        </div>
        <div className="p-2 rounded bg-gray-800/30">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {t('Стоп')}
          </div>
          <div className="font-mono text-red-400">${formatPrice(signal.stop_loss)}</div>
        </div>
        <div className="p-2 rounded bg-gray-800/30">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
            <Target className="w-3 h-3" />
            {t('Цель')}
          </div>
          <div className="font-mono text-green-400">${formatPrice(signal.target)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border-t border-gray-800/50 pt-2">
        <div>
          <span className="text-gray-400">R:R </span>
          <span className="text-white font-mono">1:{signal.rr.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-400">{t('Риск')} </span>
          <span className="text-white font-mono">{(signal.risk * 100).toFixed(2)}%</span>
        </div>
        {signal.htf && (
          <div title={`${t('Тренд старшего ТФ')} (${signal.htf.timeframe}): ${t(signal.htf.trend)}`}>
            <span className="text-gray-400">HTF {signal.htf.timeframe} </span>
            <span className={signal.htf.aligned ? 'text-green-400' : 'text-orange-400'}>
              {signal.htf.aligned ? t('✓ согласован') : t('⚠ против')}
            </span>
          </div>
        )}
        {/* Класс подтверждения по Нисону (гл. 3–6): когда входить по правилу книги */}
        {(() => {
          const nextCandle = signal.confirmation_class === 'next_candle';
          return (
            <div
              title={nextCandle
                ? t('Нисон гл. 3–6: модель требует закрытия СЛЕДУЮЩЕЙ свечи в направлении сигнала — вход только после подтверждения')
                : t('Нисон гл. 5–6: завершённая формация — её последняя свеча и есть подтверждение, отдельная следующая свеча не требуется')}
            >
              <span className="text-gray-400">{t('Подтверждение')} </span>
              <span className={nextCandle ? 'text-sky-400' : 'text-gray-300'}>
                {nextCandle ? t('⏳ ждём след. свечу') : t('✓ внутри модели')}
              </span>
            </div>
          );
        })()}
        {(() => {
          const cls = st === 'confirmed' ? 'bg-green-500/10 text-green-400'
            : st === 'pending' ? 'bg-yellow-500/10 text-yellow-400'
            : 'bg-gray-400/10 text-gray-400';
          return (
            <span className={`px-2 py-1 rounded ${cls}`}>
              {st === 'confirmed' ? '✓' : st === 'pending' ? '⏳' : '–'} {t(STATUS_LABEL[st as keyof typeof STATUS_LABEL])}
            </span>
          );
        })()}
      </div>

      {/* «Путь цены» до цели: формальный RR vs adjusted RR, препятствия транзита */}
      {signal.path && (
        <div className="mt-2">
          <PricePathCard signal={signal} />
        </div>
      )}

      {/* Аудит №10: план размера позиции по правилу фиксированного риска */}
      {signal.position_plan && (
        <div className="mt-3 p-3 rounded-lg bg-gray-800/30 border border-gray-700/40">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {t('План позиции')} ({riskSettings.capitalUsd.toLocaleString(locale)} $, {t('риск')} {(riskSettings.riskPct * 100).toFixed(1)}%)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-gray-400">{t('Объём (позиция)')}</div>
              <div className="font-mono text-white">{signal.position_plan.qty.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-gray-400">{t('Номинал')}</div>
              <div className="font-mono text-white">{Math.round(signal.position_plan.notional_usd).toLocaleString(locale)} $</div>
            </div>
            <div>
              <div className="text-gray-400">{t('Убыток по стопу')}</div>
              <div className="font-mono text-red-400">
                −{Math.round(signal.position_plan.worst_case_loss_usd).toLocaleString(locale)} $
                {' '}({signal.position_plan.worst_case_loss_pct.toFixed(2)}%)
              </div>
            </div>
            <div>
              <div className="text-gray-400">{t('Издержки цикла')}</div>
              <div className="font-mono text-yellow-400">{Math.round(signal.position_plan.cost_reserve_usd)} $</div>
            </div>
          </div>
          {signal.position_plan.capped_by_notional && (
            <div className="text-[11px] text-orange-400 mt-1">
              {t('⚠ Объём ограничен потолком номинала — фактический риск меньше заявленного.')}
            </div>
          )}
        </div>
      )}

      {signal.story && (
        <div className="mt-3 p-3 rounded bg-gray-800/30 text-xs text-gray-400 flex items-start gap-1.5">
          <Icon name="story" className="text-gray-500 mt-0.5" />
          <span>{t(signal.story)}</span>
        </div>
      )}

      <div className="mt-3 p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">
        {t('✓ Сигнал автоматически сохранён в журнал')}
      </div>
    </div>
  );
}
