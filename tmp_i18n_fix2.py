# -*- coding: utf-8 -*-
"""Финальная локализация: VolumeProfilePanel (title), MarketContextPanels (PHASE_DETAILS, VERDICT_META), Backtest (ошибки/метки)."""

def apply(path, reps):
    s = open(path, encoding='utf-8').read()
    missing = []
    for old, new in reps:
        if old in s:
            s = s.replace(old, new, 1)
        else:
            missing.append(old[:70])
    open(path, 'w', encoding='utf-8').write(s)
    return missing

VP = 'src/components/VolumeProfilePanel.tsx'
reps_vp = [
    ("% ${(b.share * 100).toFixed(1)}% ${t('объёма')}", "% ${(b.share * 100).toFixed(1)}% {t('объёма')}"),
]

MC = 'src/components/MarketContextPanels.tsx'
reps_mc = [
    # PHASE_DETAILS — перевод на месте рендера через translateString (EN-словарь фаз в dictionaries.ts)
    ("import { useI18n } from '../i18n';",
     "import { useI18n } from '../i18n';\nimport { translateString as TR } from '../i18n/dictionaries';"),
    ("  const { t } = useI18n();\n\n  return (\n    <div className=\"panel p-4 \">",
     "  const { t, lang } = useI18n();\n  // Подробные описания фаз хранятся по-русски — переводим динамически (EN-блок в dictionaries.ts)\n  const dEn = <T extends { title: string; what: string; who: string; volume: string; action: string }>(d: T): T =>\n    lang === 'en' ? { ...d, title: TR(d.title, 'en'), what: TR(d.what, 'en'), who: TR(d.who, 'en'), volume: TR(d.volume, 'en'), action: TR(d.action, 'en') } : d;\n\n  return (\n    <div className=\"panel p-4 \">"),
    ("{t(details.title)}", "{t(dEn(details).title)}"),
    ("<span className=\"text-gray-300\">{t(details.what)}</span>", "<span className=\"text-gray-300\">{t(dEn(details).what)}</span>"),
    ("<span className=\"text-gray-300\">{t(details.who)}</span>", "<span className=\"text-gray-300\">{t(dEn(details).who)}</span>"),
    ("<span className=\"text-gray-300\">{t(details.volume)}</span>", "<span className=\"text-gray-300\">{t(dEn(details).volume)}</span>"),
    ("<span className=\"text-gray-300\">{t(details.action)}</span>", "<span className=\"text-gray-300\">{t(dEn(details).action)}</span>"),
    # VERDICT_META — метки через t уже есть? label рендерится как {t(v.label)} — ок, словарь пополним ниже.
]

BT = 'src/pages/Backtest.tsx'
reps_bt = [
    (".catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить данные Bybit'); })",
     ".catch((e) => { if (!cancelled) setError(TR(e instanceof Error ? e.message : 'Не удалось загрузить данные Bybit', lang)); })"),
    ("const TIMEFRAMES: Array<[string, string]> = [\n  ['30m', '30м'], ['1H', '1ч'], ['4H', '4ч'], ['1D', '1Д'], ['1W', '1Нд'],\n];",
     "// Метки ТФ: [value, ru, en]\nconst TIMEFRAMES: Array<[string, string, string]> = [\n  ['30m', '30м', '30m'], ['1H', '1ч', '1h'], ['4H', '4ч', '4h'], ['1D', '1Д', '1D'], ['1W', '1Нд', '1W'],\n];"),
]

for path, reps in ((VP, reps_vp), (MC, reps_mc), (BT, reps_bt)):
    m = apply(path, reps)
    print(path, 'MISSING:', m)
