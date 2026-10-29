/**
 * Единый источник SEO-метаданных (title/description/canonical) для всех страниц.
 * Используется через <Seo> (react-helmet-async) и при генерации sitemap.xml.
 */

export const SITE_URL = 'https://kairi.pro';
export const SITE_NAME = 'Kairi Analytics';

/** Инструменты, продвигаемые отдельными посадочными страницами /analysis/<SYMBOL>. */
export const SEO_SYMBOLS: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: 'BTCUSDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', name: 'Solana' },
  { symbol: 'BNBUSDT', name: 'BNB' },
  { symbol: 'XRPUSDT', name: 'Ripple' },
  { symbol: 'ADAUSDT', name: 'Cardano' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin' },
  { symbol: 'AVAXUSDT', name: 'Avalanche' },
];

/** Красивый тикер: BTCUSDT -> BTC/USDT; акции AAPL:STOCK -> AAPL */
export function prettyTicker(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith(':STOCK')) return s.slice(0, -':STOCK'.length);
  return s.endsWith('USDT') ? `${s.slice(0, -4)}/USDT` : s;
}

export interface PageMeta {
  title: string;
  description: string;
  path: string; // '/', '/backtest', '/journal', '/analysis/BTCUSDT'
  /** Частота обновления для sitemap.xml */
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

export function dashboardMeta(): PageMeta {
  return {
    title: `${SITE_NAME} — анализ крипто рынка по методу Стива Нисона`,
    description:
      'Автоматический поиск свечных паттернов Стива Нисона на Bybit и Binance, объёмный профиль, уровни поддержки и сопротивления, торговые сигналы с расчётом риска и честный бэктест стратегии.',
    path: '/',
    changefreq: 'daily',
    priority: 1.0,
  };
}

export function analysisMeta(symbol: string): PageMeta {
  const known = SEO_SYMBOLS.find((s) => s.symbol === symbol.toUpperCase());
  const ticker = prettyTicker(symbol.toUpperCase());
  const coin = known ? ` ${known.name}` : '';
  return {
    title: `${ticker}${coin} — анализ, паттерны Нисона и сигналы | ${SITE_NAME}`,
    description:
      `Живой график ${ticker}: автоматическое распознавание свечных моделей Нисона (молот, поглощение, доджи, харами и др.), зоны интереса по объёму, уровни S/R, подтверждённые сигналы со стопом и целью, журнал сделок.${known ? ' Аналитика ' + known.name + ' в реальном времени.' : ''}`,
    path: `/analysis/${symbol.toUpperCase()}`,
    changefreq: 'daily',
    priority: 0.9,
  };
}

export function backtestMeta(): PageMeta {
  return {
    title: `Бэктест стратегии Нисона — статистика сигналов | ${SITE_NAME}`,
    description:
      'Честный бэктест торговых сигналов по методу Стива Нисона: вход по подтверждённой модели, стоп от экстремума формации, выход на ближайшей структурной цели. Статистика win-rate, средний R и вердикты по каждому паттерну.',
    path: '/backtest',
    changefreq: 'weekly',
    priority: 0.8,
  };
}

export function journalMeta(): PageMeta {
  return {
    title: `Журнал сигналов и сделок — учёт результатов | ${SITE_NAME}`,
    description:
      'Журнал всех сигналов по методу Нисона: история входов, стопов и целей, разбор закрытых сделок, накопленная статистика по паттернам и контроль качества исполнения плана.',
    path: '/journal',
    changefreq: 'weekly',
    priority: 0.7,
  };
}

/** Все страницы для sitemap.xml */
export function allSitemapPages(): PageMeta[] {
  return [
    dashboardMeta(),
    ...SEO_SYMBOLS.map((s) => analysisMeta(s.symbol)),
    backtestMeta(),
    journalMeta(),
  ];
}

export function buildSitemapXml(pages: PageMeta[] = allSitemapPages()): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .map(
      (p) =>
        `  <url>\n` +
        `    <loc>${SITE_URL}${p.path}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${p.changefreq}</changefreq>\n` +
        `    <priority>${p.priority.toFixed(1)}</priority>\n` +
        `  </url>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}
