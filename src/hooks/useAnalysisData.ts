// Вынос из Analysis.tsx (реконструкция): загрузка отчёта анализа + мульти-ТФ карты зон.
// Логика и семантика состояний сохранены без изменений.

import { useEffect, useState } from 'react';
import { api, type AnalysisReport } from '../api/client';
import type { MultiTFZonesDTO } from '../api/types';
import { describeNetworkError } from '../utils/http';

export interface AnalysisDataState {
  report: AnalysisReport | null;
  setReport: (updater: (prev: AnalysisReport | null) => AnalysisReport | null) => void;
  multiZones: MultiTFZonesDTO[];
  loading: boolean;
  error: string | null;
  /** Полный реанализ через REST (opts.force — сброс серверного кэша) */
  loadAnalysis: (opts?: { force?: boolean }) => Promise<void>;
}

export function useAnalysisData(symbol: string | undefined, timeframe: string): AnalysisDataState {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  // Мульти-ТФ карта зон S/R (загружается отдельно от основного анализа)
  const [multiZones, setMultiZones] = useState<MultiTFZonesDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = async (opts: { force?: boolean } = {}) => {
    if (!symbol) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.getAnalysis(symbol, timeframe, opts);
      setReport(data);
    } catch (err) {
      console.error('Ошибка загрузки анализа:', err);
      setError(describeNetworkError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  // Мульти-ТФ карта зон: грузится параллельно с основным анализом, ошибки не блокируют страницу
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const tfs = ['15', '60', '4H', 'D', 'W'];
    if (!tfs.includes(timeframe)) tfs.push(timeframe);
    api.getMultiTimeframeZones(symbol, tfs)
      .then((rows) => { if (!cancelled) setMultiZones(rows); })
      .catch((err) => { console.error('Ошибка мульти-ТФ зон:', err); if (!cancelled) setMultiZones([]); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  return { report, setReport, multiZones, loading, error, loadAnalysis };
}
