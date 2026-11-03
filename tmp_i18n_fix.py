# -*- coding: utf-8 -*-
import sys

def apply(path, reps):
    s = open(path, encoding='utf-8').read()
    missing = []
    for old, new in reps:
        if old in s:
            s = s.replace(old, new)
        else:
            missing.append(old[:70])
    open(path, 'w', encoding='utf-8').write(s)
    return missing

VP = 'src/components/VolumeProfilePanel.tsx'
reps_vp = [
    ('role="img" aria-label="Профиль объёма">', "role=\"img\" aria-label={t('Профиль объёма')}>"),
    ("<title>{`${formatPrice(b.low)}–${formatPrice(b.high)} · ${(b.share * 100).toFixed(1)}% объёма`}</title>",
     "<title>{`${formatPrice(b.low)}–${formatPrice(b.high)} · ${(b.share * 100).toFixed(1)}% ${t('объёма')}`}</title>"),
    ('fill="#e2e8f0">Цена ${formatPrice(price)}</text>', "fill=\"#e2e8f0\">{t('Цена')} ${formatPrice(price)}</text>"),
    ('fill={dirColor}>Вход ${formatPrice(signal.entry_price)}</text>', "fill={dirColor}>{t('Вход')} ${formatPrice(signal.entry_price)}</text>"),
    ('fill={dirColor}>Цель ${formatPrice(signal.target)}</text>', "fill={dirColor}>{t('Цель')} ${formatPrice(signal.target)}</text>"),
    ('fill="#f87171">Стоп ${formatPrice(signal.stop_loss)}</text>', "fill=\"#f87171\">{t('Стоп')} ${formatPrice(signal.stop_loss)}</text>"),
    ("<title>{`${o.kind === 'hvn' ? 'HVN-узел' : 'S/R-зона'} ${formatPrice(o.level)} · сила ${(o.strength * 100).toFixed(0)}% · ${o.detail}`}</title>",
     "<title>{`${o.kind === 'hvn' ? t('HVN-узел') : t('S/R-зона')} ${formatPrice(o.level)} · ${t('сила')} ${(o.strength * 100).toFixed(0)}% · ${t(o.detail)}`}</title>"),
    ('<text x={padL + 11} y={H - 5}>HVN (трение)</text>', "<text x={padL + 11} y={H - 5}>{t('HVN (трение)')}</text>"),
    ('<text x={padL + 93} y={H - 5}>LVN (дыра — быстрый проход)</text>', "<text x={padL + 93} y={H - 5}>{t('LVN (дыра — быстрый проход)')}</text>"),
    ('<text x={padL + 400} y={H - 5}>Путь цены: {signal.pattern}</text>', "<text x={padL + 400} y={H - 5}>{t('Путь цены:')} {t(signal.pattern)}</text>"),
    ('{TREND_LABEL_RU[summary.delta_trend] ?? summary.delta_trend}', '{t(TREND_LABEL_RU[summary.delta_trend] ?? summary.delta_trend)}'),
    ("медвежьих сильных дисбалансов. Их скопление у уровня поддержки — типичное «всасывание» предложения по Нисону; у сопротивления — активность распределения.\n",
     "{t('медвежьих сильных дисбалансов. Их скопление у уровня поддержки — типичное «всасывание» предложения по Нисону; у сопротивления — активность распределения.')}\n"),
    ("Растёт = рынок чистят покупатели; падает = продавцы; плоская при движении цены = работу делает пассивная сторона (тонкая ликвидность).\n",
     "{t('Растёт = рынок чистят покупатели; падает = продавцы; плоская при движении цены = работу делает пассивная сторона (тонкая ликвидность).')}\n"),
    ("— за свечу агрессия покупателей превысила агрессию продавцов (покупали по рынку / «били в аск»).{' '}",
     "{t('— за свечу агрессия покупателей превысила агрессию продавцов (покупали по рынку / «били в аск»).')}{' '}"),
    ("— наоборот, продавали в рынок. Высота столбца = величина перевеса.",
     "{t('— наоборот, продавали в рынок. Высота столбца = величина перевеса.')}"),
    ("— дисбаланс агрессии (перевес одной стороны ≥3:1 внутри бара). За окном найдено:{' '}",
     "{t('— дисбаланс агрессии (перевес одной стороны ≥3:1 внутри бара). За окном найдено:')}{' '}"),
    ("? 'закрытия жмутся к вершинам свечей, buyers держат финал каждого бара' : summary.avg_clv <= -0.2 ? 'закрытия у оснований свечей — продавцы закрывают бары на минимумах, давление реальное' : 'закрытия в середине диапазонов — ни одна сторона не продавила итог бара (борьба/флэт)'",
     "? t('закрытия жмутся к вершинам свечей, buyers держат финал каждого бара') : summary.avg_clv <= -0.2 ? t('закрытия у оснований свечей — продавцы закрывают бары на минимумах, давление реальное') : t('закрытия в середине диапазонов — ни одна сторона не продавила итог бара (борьба/флэт)')"),
    ("<b className=\"text-gray-300\">Последние {lastN.length} баров:</b>", "<b className=\"text-gray-300\">{t('Последние')} {lastN.length} {t('баров')}:</b>"),
    ("{recentSum >= 0 ? 'на свежем участке спрос перевешивает' : 'на свежем участке перевешивает предложение'} (важнее всей линии: показывает, кто контролирует рынок прямо сейчас).",
     "{recentSum >= 0 ? t('на свежем участке спрос перевешивает') : t('на свежем участке перевешивает предложение')} {t('(важнее всей линии: показывает, кто контролирует рынок прямо сейчас).')}"),
    ("<Icon name=\"warning\" className=\"mr-1\" />Proxy-оценка по OHLCV: тикового стакана/ленты Bybit здесь нет, поэтому дельта вычисляется из формы свечи (тело + позиция закрытия + объём). Она надёжна для оценки перекоса агрессии и дивергенций, но абсолютные числа не равны биржевой дельте из footprint-терминалов. Правило Нисона сохраняется: любой сигнал подтверждается только на следующей свече.",
     "<Icon name=\"warning\" className=\"mr-1\" />{t('Proxy-оценка по OHLCV: тикового стакана/ленты Bybit здесь нет, поэтому дельта вычисляется из формы свечи (тело + позиция закрытия + объём). Она надёжна для оценки перекоса агрессии и дивергенций, но абсолютные числа не равны биржевой дельте из footprint-терминалов. Правило Нисона сохраняется: любой сигнал подтверждается только на следующей свече.')}\n      {/* key: delta proxy disclaimer */}"),
    ('role="img" aria-label="Дельта агрессии">', "role=\"img\" aria-label={t('Дельта агрессии')}>"),
    ("<title>{`Δ ${p.delta.toFixed(0)} · CLV ${p.clv.toFixed(2)}${p.imbalance ? ` · дисбаланс: ${p.imbalance}` : ''}`}</title>",
     "<title>{`Δ ${p.delta.toFixed(0)} · CLV ${p.clv.toFixed(2)}${p.imbalance ? ` · ${t('дисбаланс')}: ${p.imbalance}` : ''}`}</title>"),
    ('<span title="Сумма proxy-дельт за окно (агрессия покупателей минус продавцов)">\n          Накопленная дельта:{\' \}',
     "<span title={t('Сумма proxy-дельт за окно (агрессия покупателей минус продавцов)')}>\n          {t('Накопленная дельта:')}\u2009{' '}"),
    ('<span title="Средний Close Location Value: закрытия у вершин (+) или оснований (−) диапазона">',
     "<span title={t('Средний Close Location Value: закрытия у вершин (+) или оснований (−) диапазона')}>"),
    ('<span className="text-gray-600">* proxy-оценка по OHLCV (без тикового footprint)</span>',
     "<span className=\"text-gray-600\">* {t('proxy-оценка по OHLCV (без тикового footprint)')}</span>"),
    ("значимость зоны: два независимых метода указывают на одну цену.`)}",
     "значимость зоны: два независимых метода указывают на одну цену.`)}"),
]

MC = 'src/components/MarketContextPanels.tsx'
reps_mc = [
    ("{ label: 'Преимущество подтверждено',", "{ label: 'Преимущество подтверждено',"),
]
# PHASE_DETAILS rendering: wrap fields through t() at render site instead of dictionary-per-field.
reps_mc = [
    ("<div>\n              <span className=\"text-gray-400 font-medium\">{t('Что происходит: ')}</span>",
     "<div>\n              <span className=\"text-gray-400 font-medium\">{t('Что происходит: ')}</span>"),
    ('title="0 R"', 'title="0 R"'),
]

m1 = apply(VP, reps_vp)
print('VP missing:', m1)
