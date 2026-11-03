// dictionaries.ts — словари локализации (ru/en).
// Ключевые слова словарей совпадают с русскими строками приложения (fallback = ru),
// поэтому пропущенный перевод не ломает UI — просто остаётся по-русски.

export type Lang = 'ru' | 'en';

/** Метки трендового контекста движков ('ВОСХОДЯЩИЙ' | 'НИСХОДЯЩИЙ' | 'БОКОВИК') */
export const TREND_LABELS_EN: Record<string, string> = {
  'ВОСХОДЯЩИЙ': 'BULLISH',
  'НИСХОДЯЩИЙ': 'BEARISH',
  'БОКОВИК': 'RANGE',
};

/** Свечные модели: каноническое имя → английское название (см. utils/pattern_ids.ts) */
export const PATTERN_NAMES_EN: Record<string, string> = {
  'МОЛОТ': 'Hammer',
  'МОЛОТ (НЕСОВЕРШЕННЫЙ)': 'Imperfect Hammer',
  'ПЕРЕВЁРНУТЫЙ МОЛОТ': 'Inverted Hammer',
  'ПОВЕШЕННЫЙ': 'Hanging Man',
  'ПАДАЮЩАЯ ЗВЕЗДА': 'Shooting Star',
  'БЫЧЬЕ ПОГЛОЩЕНИЕ': 'Bullish Engulfing',
  'МЕДВЕЖЬЕ ПОГЛОЩЕНИЕ': 'Bearish Engulfing',
  'УТРЕННЯЯ ДОДЖИ-ЗВЕЗДА': 'Morning Doji Star',
  'ВЕЧЕРНЯЯ ДОДЖИ-ЗВЕЗДА': 'Evening Doji Star',
  'УТРЕННЯЯ ЗВЕЗДА': 'Morning Star',
  'ВЕЧЕРНЯЯ ЗВЕЗДА': 'Evening Star',
  'ТРИ БЕЛЫХ СОЛДАТА': 'Three White Soldiers',
  'ТРИ ЧЁРНЫХ ВОРОНЫ': 'Three Black Crows',
  'ДВЕ ВЗЛЕТЁВШИЕ ВОРОНЫ': 'Two Rising Crows',
  'ДОДЖИ': 'Doji',
  'ДОДЖИ-СТРЕКОЗА': 'Dragonfly Doji',
  'НАДГРОБИЕ': 'Gravestone Doji',
  'СПРУЖИНИВАНИЕ (ЛОЖНЫЙ ПРОБОЙ ДНА)': 'Spring (False Low Breakout)',
  'БАШЕННАЯ ВЕРШИНА': 'Tower Top',
  'БАШЕННОЕ ДНО': 'Tower Bottom',
  'ТРИ ГОРЫ (ВЕРШИНА)': 'Three Mountains (Top)',
  'ТРИ РЕКИ (ОСНОВАНИЕ)': 'Three Rivers (Bottom)',
  'БЫЧИЙ ХАРАМИ': 'Bullish Harami',
  'МЕДВЕЖИЙ ХАРАМИ': 'Bearish Harami',
  'БЫЧИЙ ХАРАМИ-КРЕСТ': 'Bullish Harami Cross',
  'МЕДВЕЖИЙ ХАРАМИ-КРЕСТ': 'Bearish Harami Cross',
  'ПИНЦЕТ (НИЗ)': 'Tweezer Bottom',
  'ПИНЦЕТ (ВЕРХ)': 'Tweezer Top',
  'ЗАВЕСА ИЗ ТЁМНЫХ ОБЛАКОВ': 'Dark Cloud Cover',
  'ПРОСВЕТ В ОБЛАКАХ': 'Lightning at the Well',
  'ЛИНИЯ ПОЯСА (БЫЧЬЯ)': 'Belt-hold (Bullish)',
  'ЛИНИЯ ПОЯСА (МЕДВЕЖЬЯ)': 'Belt-hold (Bearish)',
  'КОНТРАТАКА (БЫЧЬЯ)': 'Counterattack (Bullish)',
  'КОНТРАТАКА (МЕДВЕЖЬЯ)': 'Counterattack (Bearish)',
  'РАЗДЕЛЕНИЕ (БЫЧЬЕ)': 'Separating Lines (Bullish)',
  'РАЗДЕЛЕНИЕ (МЕДВЕЖЬЕ)': 'Separating Lines (Bearish)',
  'НИЖЕ ШЕИ': 'Advance Block',
  'НА ШЕЕ': 'Retreat Block',
  'ТОЛЧОК': 'Thrusting Line',
  'ДВОЙНОЙ ТОЛЧОК (БЫЧИЙ)': 'Double Thrusting (Bullish)',
  'ГЭП СМЕЖНЫХ БЕЛЫХ СВЕЧЕЙ': 'Side-by-side White Lines Gap',
  'ВОСХОДЯЩИЕ ТРИ МЕТОДА': 'Rising Three Methods',
  'НИСХОДЯЩИЕ ТРИ МЕТОДА': 'Falling Three Methods',
  'УДЕРЖАНИЕ НА ТАТАМИ': 'Tatami-supporting Return',
  'ЛЕСТНИЧНОЕ ДНО': 'Ladder Bottom',
  'ПОКИНУТЫЙ МЛАДЕНЕЦ (НИЗ)': 'Abandoned Baby (Bottom)',
  'ПОКИНУТЫЙ МЛАДЕНЕЦ (ВЕРХ)': 'Abandoned Baby (Top)',
  'ТАСУКИ ВОСХОДЯЩЕГО ГЭПА': 'Tasuki Gap (Up)',
  'ТАСУКИ НИСХОДЯЩЕГО ГЭПА': 'Tasuki Gap (Down)',
  'ГЭП НА МАКСИМУМАХ': 'Gapping Play (High)',
  'ГЭП НА МИНИМУМАХ': 'Gapping Play (Low)',
  'ПРОРЫВ КОНСОЛИДАЦИИ (БЫЧИЙ)': 'Consolidation Breakout (Bullish)',
  'ПРОРЫВ КОНСОЛИДАЦИИ (МЕДВЕЖИЙ)': 'Consolidation Breakout (Bearish)',
  'КЛЮЧЕВОЙ РАЗВОРОТ (БЫЧИЙ)': 'Key Reversal (Bullish)',
  'КЛЮЧЕВОЙ РАЗВОРОТ (МЕДВЕЖИЙ)': 'Key Reversal (Bearish)',
  'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ОСНОВАНИЕ)': 'Last Engulfing Position (Bottom)',
  'ПОСЛЕДНЕЕ ПОГЛОЩЕНИЕ (ВЕРШИНА)': 'Last Engulfing Position (Top)',
  'НАКОПЛЕНИЕ': 'Accumulation',
  'РАСПРЕДЕЛЕНИЕ': 'Distribution',
  'ТЕСТ ПОДДЕРЖКИ (БЫЧИЙ)': 'Support Test (Bullish)',
  'ТЕСТ СОПРОТИВЛЕНИЯ (МЕДВЕЖИЙ)': 'Resistance Test (Bearish)',
  'ДЛИННАЯ БЕЛАЯ НА ОТКАТЕ': 'Long White Line on Retreat',
  'ДЛИННАЯ ЧЁРНАЯ НА ОТКАТЕ': 'Long Black Line on Retreat',
};

/** Фразы причин детекции тренда/старта тренда (trend_detection.ts) */
const REASONS_EN: Record<string, string> = {
  'подтверждённая бычья разворотная формация (гл. 4–6)': 'confirmed bullish reversal formation (ch. 4–6)',
  'подтверждённая медвежья разворотная формация (гл. 4–6)': 'confirmed bearish reversal formation (ch. 4–6)',
  'золотой крест MA10/MA65 — свежее пересечение (гл. 13)': 'golden cross MA10/MA65 — fresh crossover (ch. 13)',
  'мёртвый крест MA10/MA65 — свежее пересечение (гл. 13)': 'death cross MA10/MA65 — fresh crossover (ch. 13)',
  'цена выше MA65, средняя развернулась вверх (гл. 13)': 'price above MA65, the average turned up (ch. 13)',
  'цена ниже MA65, средняя развернулась вниз (гл. 13)': 'price below MA65, the average turned down (ch. 13)',
  'объём растёт вместе с ценой (гл. 15)': 'volume rising with price (ch. 15)',
  'объём растёт при падении цены (гл. 15)': 'volume rising as price falls (ch. 15)',
  'верхнее спружинивание: ложный пробой и возврат (гл. 11)': 'upper spring: false breakout and return (ch. 11)',
  'нижнее спружинивание: ложный пробой и возврат (гл. 11)': 'lower spring: false breakout and return (ch. 11)',
  'полярность: пробитый уровень стал поддержкой (гл. 11)': 'polarity: broken level became support (ch. 11)',
  'полярность: пробитый уровень стал сопротивлением (гл. 11)': 'polarity: broken level became resistance (ch. 11)',
  'бычья дивергенция у перепроданности (гл. 14)': 'bullish divergence near oversold (ch. 14)',
  'медвежья дивергенция у перекупленности (гл. 14)': 'bearish divergence near overbought (ch. 14)',
  'окно вверх открыто и не закрыто (гл. 7)': 'upward window open and unfilled (ch. 7)',
  'окно вниз открыто и не закрыто (гл. 7)': 'downward window open and unfilled (ch. 7)',
};

/** Фазы Вайкоффа (короткая метка + полное описание из utils/wyckoff.ts) */
const WYCKOFF_EN: Record<string, string> = {
  'Накопление (Вайкофф): диапазон после падения, объём тяготеет к низам — крупные игроки набирают позицию':
    'Accumulation (Wyckoff): range after a decline, volume skewed to lows — big players are building positions',
  'Рост (markup): цена обновила вершину диапазона — фаза восходящего движения':
    'Markup: price made a new range high — uptrend phase',
  'Распределение (Вайкофф): диапазон после роста, объём тяготеет к верхам — позиция передаётся рынку':
    'Distribution (Wyckoff): range after a rally, volume skewed to highs — positions are handed to the market',
  'Падение (markdown): цена пробила основание диапазона — фаза нисходящего движения':
    'Markdown: price broke the range low — downtrend phase',
  'Переход: явной фазы цикла не определено': 'Transition: no explicit cycle phase detected',
  'Накопление': 'Accumulation',
  'Рост': 'Markup',
  'Распределение': 'Distribution',
  'Падение': 'Markdown',
  'Переход': 'Transition',
};

/** Причины голосов зон S/R (zone_voter.ts / title в мульти-ТФ панели) */
const ZONE_REASONS_EN: Record<string, string> = {
  'свинг': 'swing',
  'экстремум': 'extreme',
  'круглый уровень': 'round number',
  'скользящая средняя': 'moving average',
  'гэп': 'gap',
  'полярность': 'polarity',
  'пробой': 'breakout',
};

/** Суффиксы имён паттернов: 'МОЛОТ (У ПОДДЕРЖКИ) (ОБЪЁМ)' */
const PATTERN_SUFFIX_EN: Record<string, string> = {
  'У ПОДДЕРЖКИ': 'AT SUPPORT',
  'У СОПРОТИВЛЕНИЯ': 'AT RESISTANCE',
  'ОБЪЁМ': 'VOLUME',
  'ОБЪЕМА': 'VOLUME',
};

/** Общие UI-строки: RU (ключ) → EN */
export const UI_STRINGS: Record<string, string> = {
  // ── Layout / навигация ──
  'Обзор': 'Overview',
  'Журнал': 'Journal',
  'Бэктест': 'Backtest',
  'Тарифы': 'Pricing',
  'Бэктест паттернов Нисона': 'Nison Pattern Backtest',
  'Поддержать': 'Support',
  'Поддержать проект': 'Support the project',
  'Поддержать развитие проекта (TON)': 'Support the project development (TON)',
  'Сервис носит информационный характер и не является индивидуальной инвестиционной рекомендацией.':
    'This service is informational only and does not constitute investment advice.',
  'Публичная оферта': 'Terms of Service',
  'Политика конфиденциальности': 'Privacy Policy',
  'Правовые документы': 'Legal documents',
  'Раздел временно недоступен — мы его дорабатываем.': 'This section is temporarily unavailable — we are improving it.',
  'Вернуться на обзор рынка': 'Back to market overview',

  // ── Dashboard ──
  'Крипто': 'Crypto',
  'TradFi · Акции США': 'TradFi · US Stocks',
  'Обзор рынка': 'Market Overview',
  ' по методологии Нисона': ' by Nison methodology',
  'Контекст → Паттерны → Подтверждение → Объём': 'Context → Patterns → Confirmation → Volume',
  'Обновлено:': 'Updated:',
  'Обновить': 'Refresh',
  'Режим рынка': 'Market regime',
  'Уверенность': 'Confidence',
  'Ключевые уровни': 'Key levels',
  'Поддержка': 'Support',
  'Сопротивление': 'Resistance',
  'Объём': 'Volume',
  'Ошибка анализа': 'Analysis error',
  'Ошибка загрузки': 'Loading error',
  'Нет данных для отображения': 'No data to display',
  'Ваш запрос': 'Your query',
  'Убрать карточку': 'Remove card',
  'Убрать': 'Remove',
  'Очистить': 'Clear',
  'Введите тикер акции, например AAPL, MSFT…': 'Enter a stock ticker, e.g. AAPL, MSFT…',
  'Введите тикер, например TAO, ARB, PEPE…': 'Enter a ticker, e.g. TAO, ARB, PEPE…',
  'Анализируем…': 'Analyzing…',
  'Анализировать': 'Analyze',
  'Методология Стива Нисона': 'Steve Nison Methodology',
  '1. Контекст': '1. Context',
  'Определяем тренд и режим рынка. Торгуем только в направлении тренда.':
    'We identify the trend and market regime. We trade only in the direction of the trend.',
  '2. Паттерны': '2. Patterns',
  'Ищем свечные паттерны в контексте тренда. Паттерны без контекста не работают.':
    'We look for candlestick patterns within the trend context. Patterns without context do not work.',
  '3. Подтверждение': '3. Confirmation',
  'Каждый паттерн должен быть подтверждён следующей свечой или объёмом.':
    'Every pattern must be confirmed by the next candle or by volume.',
  '4. Правило множества': '4. Rule of Confluence',
  'Минимум 3 независимых сигнала для входа. Consensus score показывает силу.':
    'At least 3 independent signals to enter. The consensus score shows the strength.',
  'Не удалось получить данные по акциям (Twelvedata). Котировочный прокси недоступен — попробуйте позже.':
    'Failed to fetch stock data (Twelvedata). The quote proxy is unavailable — please try again later.',
  'Не удалось получить данные с Bybit API': 'Failed to fetch data from the Bybit API',

  // ── Analysis page ──
  'Загрузка анализа...': 'Loading analysis...',
  'Ошибка': 'Error',
  'Данные не найдены': 'Data not found',
  'Назад к обзору': 'Back to overview',
  'Цена и свеча обновляются в реальном времени через WebSocket Bybit':
    'Price and candle update in real time via Bybit WebSocket',
  'Контекст рынка': 'Market Context',
  'График': 'Chart',
  ' паттернов': ' patterns',
  ' зон': ' zones',
  'Контекст рынка и объёма': 'Market & Volume Context',
  'Вайкофф:': 'Wyckoff:',
  'Зоны поддержки и сопротивления': 'Support & Resistance Zones',
  'кластеризация + сила по касаниям (Нисон)': 'clustering + touch-based strength (Nison)',
  'Подтверждённые паттерны': 'Confirmed Patterns',
  'Подтверждённые паттерны ({n})': 'Confirmed patterns ({n})',
  'Сценарии ({n})': 'Scenarios ({n})',
  ' из ': ' of ',
  '· подтверждены объёмом/уровнем': '· confirmed by volume/level',
  'Сценарии (Нисон: ожидание → подтверждение)': 'Scenarios (Nison: anticipation → confirmation)',
  'Индикаторы': 'Indicators',
  'Тренд': 'Trend',
  'Внимание:': 'Note:',
  'Данный анализ основан на методологии Стива Нисона.': 'This analysis is based on Steve Nison’s methodology.',
  'Контекст рынка важнее отдельных паттернов. Всегда используйте подтверждение и управление рисками.':
    'Market context matters more than individual patterns. Always use confirmation and risk management.',
  'Это не является финансовой рекомендацией.': 'This is not financial advice.',

  // ── MarketContextSection ──
  'Каскад ТФ · бета': 'TF Cascade · beta',
  '⚠ не подтверждён сверху': '⚠ not confirmed by higher TF',
  'Нет подтверждения на ТФ старше того, что дало направление':
    'No confirmation on a timeframe higher than the one that set the direction',
  'Consensus Score': 'Consensus Score',
  'Уверенность:': 'Confidence:',
  'Бычий консенсус': 'Bullish consensus',
  'Медвежий консенсус': 'Bearish consensus',
  'Нейтральный': 'Neutral',
  'Оценка согласия подтверждённых свечных сценариев (последние 20 баров) в одну сторону. Противоречивые сигналы (long+short одновременно) дают низкий балл даже при их большом количестве — это шум, а не консенсус. Высокая оценка = несколько независимых паттернов, усиленных объёмом и уровнями S/R.':
    'Agreement of confirmed candlestick scenarios (last 20 bars) in one direction. Conflicting signals (long+short at once) score low even when numerous — that is noise, not consensus. A high score means several independent patterns reinforced by volume and S/R levels.',
  'Повышенный объём - подтверждение': 'Elevated volume — confirmation',
  'Низкий объём - слабость': 'Low volume — weakness',
  'Нормальный объём': 'Normal volume',

  // ── MultiTFZonesPanel ──
  'Мульти-ТФ карта уровней S/R': 'Multi-TF S/R Level Map',
  'ТФ': 'TF',
  'Масштаб': 'Scale',
  'Сопротивления ↑': 'Resistances ↑',
  'Поддержки ↓': 'Supports ↓',
  'активный': 'active',
  'каждый ТФ — со своей калибровкой': 'each TF has its own calibration',
  '★ — сильная зона (≥3 голосов); ± — полуширина зоны (ATR-калиброванная, Нисон: уровень это полоса, а не линия).':
    '★ — strong zone (≥3 votes); ± — half-width of the zone (ATR-calibrated; Nison: a level is a band, not a line).',

  // ── PatternsAndIndicators ──
  'Подтверждён:': 'Confirmed:',
  '✓ Подтверждён': '✓ Confirmed',
  'У уровня': 'At level',
  'Экстремальная перекупленность': 'Extreme overbought',
  'Перекупленность': 'Overbought',
  'Зона перепроданности': 'Oversold zone',
  'Нейтральная зона (30–70)': 'Neutral zone (30–70)',
  'По Нисону RSI — только контекст. В сильном тренде перекупленность сохраняется долго и сама по себе НЕ сигнал на продажу.':
    'Per Nison, RSI is context only. In a strong trend overbought persists for long and by itself is NOT a sell signal.',
  'Бычий импульс': 'Bullish momentum',
  'Медвежий импульс': 'Bearish momentum',
  'гистограмма от цены': 'histogram vs price',
  'Контекстный индикатор (лагирует). Вход по Нисону определяется свечами + объёмом + уровнями, а не MACD.':
    'A contextual indicator (it lags). Per Nison, entries are defined by candles + volume + levels, not MACD.',
  'Сила направленного движения': 'Directional movement strength',
  'Метрика: КПД пути цены за последние 20 баров (net move ÷ суммарные диапазоны). ~0% — флэт/шум; 40%+ — чистое направленное движение.':
    'Metric: price-path efficiency over the last 20 bars (net move ÷ summed ranges). ~0% — flat/noise; 40%+ — clean directional move.',

  // ── VolumeContextSection ──
  'Профиль объёма · HVN/LVN · Value Area': 'Volume Profile · HVN/LVN · Value Area',
  'без сигнала': 'no signal',
  'Как читать профиль объёма': 'How to read the volume profile',
  'Дельта агрессии (покупатели − продавцы)': 'Aggression delta (buyers − sellers)',
  'Как читать дельту агрессии': 'How to read the aggression delta',

  // ── CandlestickChart ──
  'ГЭП': 'GAP',
  'стоп': 'stop',
  'цель': 'target',
  'Паттерны Нисона': 'Nison patterns',

  // ── client.ts / errors ──
  'Боковик (флэт)': 'Range (flat)',
  'Восходящий тренд': 'Uptrend',
  'Нисходящий тренд': 'Downtrend',
  'Структура вершин/впадин не сформирована — разворотные паттерны надёжны только у границ диапазона (уровни S/R), продолжение тренда торговать нельзя.':
    'Swing structure has not formed — reversal patterns are reliable only at range edges (S/R levels); trading trend continuation is not allowed.',
  'Режим:': 'Regime:',
  'повышенная волатильность (ATR выше среднего) — риск шумовых ложных пробоев':
    'elevated volatility (ATR above average) — risk of noisy false breakouts',
  'Введите тикер акции, например AAPL или MSFT': 'Enter a stock ticker, e.g. AAPL or MSFT',
  'Введите название криптовалюты, например TAO или ARB': 'Enter a cryptocurrency name, e.g. TAO or ARB',
  'Инструмент не найден среди спотовых USDT-пар Bybit': 'Instrument not found among Bybit spot USDT pairs',
  'Не удалось получить данные по инструменту. Попробуйте ещё раз.': 'Failed to fetch instrument data. Please try again.',
  'Биржа ограничила частоту запросов. Подождите пару минут и попробуйте снова.':
    'The exchange rate-limited requests. Wait a couple of minutes and try again.',
  'Инструмент не найден на бирже или недоступен.': 'Instrument not found on the exchange or unavailable.',
  'Сервер биржи не ответил вовремя. Попробуйте обновить страницу.':
    'The exchange server did not respond in time. Try refreshing the page.',
  'Нет соединения с API биржи. Проверьте интернет или зайдите позже.':
    'No connection to the exchange API. Check your internet or come back later.',
  'Не удалось получить данные с биржи. Попробуйте обновить страницу.':
    'Failed to fetch data from the exchange. Try refreshing the page.',
  'Акция не найдена (Twelvedata). Проверьте тикер — доступны только котировки США.':
    'Stock not found (Twelvedata). Check the ticker — only US quotes are available.',

  // ── ErrorBoundary ──
  'Что-то пошло не так': 'Something went wrong',
  'Произошла непредвиденная ошибка в интерфейсе. Попробуйте обновить страницу — если проблема повторяется, подробности видны в консоли браузера (F12).':
    'An unexpected interface error occurred. Try refreshing the page — if it repeats, details are visible in the browser console (F12).',
  'Обновить страницу': 'Reload page',

  // ── SignalsSection (сценарии/риск-панель) ──
  'подтверждено': 'confirmed',
  'ждёт': 'pending',
  'из': 'of',
  'Риск': 'Risk',
  'риск': 'risk',
  'Капитал': 'Capital',
  'Риск на сделку': 'Risk per trade',
  'Применить': 'Apply',
  'Планы позиций пересчитаются для всех сигналов.': 'Position plans will be recalculated for all signals.',
  'Качество': 'Quality',
  'Вход': 'Entry',
  'Стоп': 'Stop',
  'Цель': 'Target',
  'Тренд старшего ТФ': 'Higher-TF trend',
  '✓ согласован': '\u2713 aligned',
  '\u26a0 против': '\u26a0 against',
  'Подтверждение': 'Confirmation',
  '\u23f3 ждём след. свечу': '\u23f3 awaiting next candle',
  '\u2713 внутри модели': '\u2713 inside the pattern',
  'План позиции': 'Position plan',
  'Объём (позиция)': 'Size',
  'Номинал': 'Notional',
  'Убыток по стопу': 'Loss at stop',
  'Издержки цикла': 'Cycle costs',
  '\u26a0 Объём ограничен потолком номинала \u2014 фактический риск меньше заявленного.':
    '\u26a0 Size capped by the notional limit \u2014 actual risk is lower than requested.',
  '\u2713 Сигнал автоматически сохранён в журнал': '\u2713 Signal saved to the journal automatically',
  'ожидает подтверждения': 'awaiting confirmation',
  'подтверждён': 'confirmed',
  'отменён (стоп пробит)': 'invalidated (stop hit)',
  'истёк (нет подтверждения)': 'expired (no confirmation)',
  'Нисон гл. 3\u20136: модель требует закрытия СЛЕДУЮЩЕЙ свечи в направлении сигнала \u2014 вход только после подтверждения':
    'Nison ch. 3\u20136: the pattern requires the NEXT candle to close in the signal direction \u2014 enter only after confirmation',
  'Нисон гл. 5\u20136: завершённая формация \u2014 её последняя свеча и есть подтверждение, отдельная следующая свеча не требуется':
    'Nison ch. 5\u20136: a completed formation \u2014 its last candle is itself the confirmation; no separate next candle is needed',

  // ── VolumeContextSection ──
  'Показать путь цены': 'Show price path',

  // ── Backtest ──
  'Бэктест в бета-версии: методика и выборка дорабатываются, результаты — ориентировочные':
    'Backtest is in beta: methodology and sample are still being refined, results are indicative',
  'Проверка': 'Testing',
  'текущей стратегии целиком': 'the current strategy as a whole',
  'подтверждённый сигнал Нисона \u2192 вход по close\n        свечи подтверждения, стоп = граница формации, тейк = ближайшая структурная цель (как в живом анализе), максимум\n        удержания 60 свечей. Результат каждой сделки уменьшен на издержки цикла':
    'a confirmed Nison signal \u2192 entry at the close of the confirmation candle, stop = formation boundary, take-profit = nearest structural target (same as live analysis), maximum holding of 60 candles. Each trade result is reduced by cycle costs',
  'Вход без lookahead: управление позицией со следующей свечи. Вердикты внизу страницы переводят статистику в\n        практический вывод — можно ли торговать паттерн на этом инструменте.':
    'No-lookahead entry: position managed from the next candle. The verdicts below turn statistics into a practical conclusion \u2014 whether this pattern can be traded on this instrument.',
  'Инструмент': 'Instrument',
  'Таймфрейм': 'Timeframe',
  'Комиссия, %/сторона': 'Fee, %/side',
  'Проскальзывание, б.п.': 'Slippage, bps',
  'Свечей в истории': 'Candles in history',
  'Загрузка свечей с Bybit…': 'Loading candles from Bybit\u2026',
  'Не удалось загрузить данные Bybit': 'Failed to load Bybit data',
  'Проверьте соединение и повторите выбор.': 'Check your connection and try again.',
  'Проверено стратегий': 'Strategies tested',
  'Всего сделок': 'Total trades',
  'Лучшая expectancy': 'Best expectancy',
  'Худшая expectancy': 'Worst expectancy',
  'Тренд вверх': 'Uptrend',
  'Тренд вниз': 'Downtrend',
  'Волатильный пробой': 'Volatile breakout',
  'сила тренда': 'trend strength',
  'волатильность': 'volatility',
  'Множитель доверия к сигналам в текущем режиме': 'Signal confidence multiplier in the current regime',
  'коэфф. сигналов': 'signal coeff.',
  'Паттерн': 'Pattern',
  'Сделок': 'Trades',
  'Итог': 'Summary',
  'накопленный net R': 'cumulative net R',
  'Недостаточно наблюдений (минимум 3 сигнала на паттерн) для статистики.':
    'Not enough observations (minimum 3 signals per pattern) for statistics.',
  'МАЛО ДАННЫХ': 'LOW DATA',
  'EDGE ПОДТВЕРЖДЁН': 'EDGE CONFIRMED',
  'EDGE НЕ ПОДТВЕРЖДЁН': 'EDGE NOT CONFIRMED',
  'УБЫТОЧЕН': 'UNPROFITABLE',
  'НЕТ РЕБРА': 'NO EDGE',
  'НЕТ ВЫВОДОВ': 'NO CONCLUSIONS',
  'РЕБРО НЕ НАЙДЕНО': 'NO EDGE FOUND',
  'СТРАТЕГИЯ РАБОТАЕТ': 'STRATEGY WORKS',
  'РЕБРО ЕСТЬ, НО УЗКОЕ': 'EDGE EXISTS BUT IS NARROW',
  'Всего {n} сделок — статистика случайна, никаких выводов делать нельзя. Накопите больше сигналов этого паттерна.':
    'Only {n} trades \u2014 the statistics are random, no conclusions can be drawn. Accumulate more signals of this pattern.',
  'Средний результат +{x} R/сделку достоверно выше нуля и подтверждён на будущих данных (OOS {y} R). Паттерн можно торговать с полным риском.':
    'Average result +{x} R/trade is reliably above zero and confirmed on future data (OOS {y} R). The pattern can be traded with full risk.',
  'История выглядит прибыльной (+{x} R), но {overfit ? \u0027на свежих данных результат заметно хуже (возможна подгонка)\u0027 : \u0027для проверки на будущих данных не хватает сделок\u0027}. Торговать осторожно, уменьшенным объёмом.':
    'History looks profitable (+{x} R), but {reason}. Trade cautiously with a reduced size.',
  'на свежих данных результат заметно хуже (возможна подгонка)': 'on fresh data the result is notably worse (possible overfitting)',
  'для проверки на будущих данных не хватает сделок': 'there are not enough trades to validate on future data',
  'Средний результат {x} R достоверно ниже нуля — на этом инструменте паттерн системно теряет. Сигналы игнорировать.':
    'Average result {x} R is reliably below zero \u2014 on this instrument the pattern systemically loses. Ignore its signals.',
  'Результат (+{x} R) неотличим от нуля — сделки закрываются «в шум». Паттерн сам по себе преимущества не даёт, используйте только как контекст.':
    'Result (+{x} R) is indistinguishable from zero \u2014 trades close \u201cinto noise\u201d. The pattern alone gives no edge; use it as context only.',
  'Сделок слишком мало ({n}) — текущая выборка не позволяет оценить стратегию.':
    'Too few trades ({n}) \u2014 the current sample does not allow evaluating the strategy.',
  'Ни одна из {n} стратегий не показала положительного результата вне шума ({m} сделок). На этом инструменте/таймфрейме паттерны Нисона сейчас не дают преимущества.':
    'None of the {n} strategies showed a positive result beyond noise ({m} trades). On this instrument/timeframe Nison patterns currently give no edge.',
  '{a} из {n} паттернов показывают достоверное ребро на {m} сделках. Текущая конфигурация подтверждена историей.':
    '{a} of {n} patterns show a reliable edge over {m} trades. The current configuration is confirmed by history.',
  'Достоверное преимущество только у {a} из {n} паттернов ({m} сделок). Торговать следует лишь отобранные стратегии, остальные — наблюдения.':
    'A reliable edge exists only for {a} of {n} patterns ({m} trades). Trade only the selected strategies; treat the rest as observations.',

  // ── Pricing ──
  'Загрузка тарифов…': 'Loading plans\u2026',
  'Доступ к аналитике и журналу сигналов по подписке. Оплата в USDT (on-chain),\n        активация после подтверждения платежа.':
    'Access to analytics and the signal journal via subscription. Payment in USDT (on-chain), activation after payment confirmation.',
  'Первый доступ': 'First access',
  'дней бесплатно': 'days free',
  'Backend недоступен (локальная разработка) — покупка отключена.':
    'Backend unavailable (local development) \u2014 purchases are disabled.',
  'Ваш аккаунт': 'Your account',
  'действует до': 'active until',
  'Заявка': 'Order',
  'ожидает подтверждения платежа…': 'awaiting payment confirmation\u2026',
  'Подписка не активна': 'Subscription is not active',
  'Обновить статус': 'Refresh status',
  'Регистрация': 'Register',
  'Email (необязательно, для восстановления доступа)': 'Email (optional, for account recovery)',
  'Создать аккаунт': 'Create account',
  'Не удалось загрузить тарифы': 'Failed to load plans',
  'Ошибка регистрации': 'Registration error',
  'Аккаунт создан. ID:': 'Account created. ID:',
  'Заявка создана': 'Order created',
  'Переведите': 'Send',
  'USDT на адрес оплаты': 'USDT to the payment address',
  '— подписка активируется после подтверждения платежа (обычно до 1 часа).':
    '\u2014 the subscription activates after payment confirmation (usually within 1 hour).',
  'Не удалось оформить заявку': 'Failed to create the order',
  'Скопировано': 'Copied',
  'Скопировать адрес': 'Copy address',
  'Все паттерны Нисона и рыночный контекст': 'All Nison patterns and market context',
  'Журнал сигналов и бэктест': 'Signal journal and backtest',
  'Синхронизация между устройствами': 'Sync across devices',
  'Текущий план': 'Current plan',
  'Создание заявки…': 'Creating order\u2026',
  'Выбрать': 'Select',
  'Оплачивая подписку, вы соглашаетесь с': 'By paying for the subscription you agree to the',
  'публичной офертой': 'Terms of Service',
  'и': 'and',
  'политикой конфиденциальности': 'Privacy Policy',
  'Free': 'Free',
  'Pro': 'Pro',
  'Premium': 'Premium',

  // ── misc ──
  'Тренд на': 'Trend on',
};

/** Перевод произвольной строки домена (паттерн/тренд/причина/фаза/UI-фраза). */
export function translateString(s: string, lang: Lang): string {
  if (lang === 'ru' || !s) return s;
  // 1) Точное совпадение со словарём UI
  const exact = UI_STRINGS[s];
  if (exact !== undefined) return exact;
  // 2) Трендовый контекст движков
  if (TREND_LABELS_EN[s]) return TREND_LABELS_EN[s];
  // 3) Имя свечи может иметь суффиксы: 'МОЛОТ (У ПОДДЕРЖКИ) (ОБЪЁМ)' —
  //    ищем самый длинный канон-префикс.
  const upper = s.toUpperCase();
  let bestName: string | null = null;
  for (const name of Object.keys(PATTERN_NAMES_EN)) {
    if (upper.startsWith(name) && (!bestName || name.length > bestName.length)) bestName = name;
  }
  if (bestName) {
    const translated = PATTERN_NAMES_EN[bestName];
    let rest = s.slice(bestName.length).trim();
    if (!rest) return translated;
    for (const [ru, en] of Object.entries(PATTERN_SUFFIX_EN)) {
      rest = rest.replace(new RegExp(ru, 'g'), en);
    }
    return `${translated} ${rest}`;
  }
  // 4) Причины тренда / Вайкофф — точное совпадение
  if (REASONS_EN[s]) return REASONS_EN[s];
  if (WYCKOFF_EN[s]) return WYCKOFF_EN[s];
  // 5) Составные строки: заменяем известные длинные подстроки (описания режимов и т.п.)
  let out = s;
  const subs: Array<[string, string]> = [
    ...Object.entries(UI_STRINGS),
    ...Object.entries(REASONS_EN),
    ...Object.entries(WYCKOFF_EN),
  ].filter(([ru]) => ru.length >= 12);
  // Длинные сначала — чтобы короткие не «съедали» часть длинных фраз
  subs.sort((a, b) => b[0].length - a[0].length);
  for (const [ru, en] of subs) {
    if (out.includes(ru)) out = out.split(ru).join(en);
  }
  // 6) Короткие токены причин зон + счётчики
  for (const [ru, en] of Object.entries(ZONE_REASONS_EN)) {
    out = out.replace(new RegExp(`(^|[\\s,;(])${ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,;)\\.])`, 'gi'), `$1${en}$2`);
  }
  out = out.replace(/(\d+)\s*касаний/g, '$1 touches').replace(/(\d+)\s*голосов/g, '$1 votes');
  return out;
}
