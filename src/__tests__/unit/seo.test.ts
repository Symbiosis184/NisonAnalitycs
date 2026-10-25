import { describe, it, expect } from 'vitest';
import {
  SITE_URL,
  SEO_SYMBOLS,
  prettyTicker,
  dashboardMeta,
  analysisMeta,
  backtestMeta,
  journalMeta,
  allSitemapPages,
  buildSitemapXml,
} from '../../utils/seo';

describe('seo meta', () => {
  it('prettyTicker превращает BTCUSDT в BTC/USDT', () => {
    expect(prettyTicker('BTCUSDT')).toBe('BTC/USDT');
    expect(prettyTicker('PAXG')).toBe('PAXG');
  });

  it('title и description укладываются в разумную длину (не обрезаются в сниппете)', () => {
    const metas = [dashboardMeta(), backtestMeta(), journalMeta(), ...SEO_SYMBOLS.map((s) => analysisMeta(s.symbol))];
    for (const m of metas) {
      expect(m.title.length).toBeLessThanOrEqual(75);
      expect(m.description.length).toBeGreaterThanOrEqual(60);
      expect(m.description.length).toBeLessThanOrEqual(320);
    }
  });

  it('каждая страница имеет уникальный title и canonical-путь', () => {
    const pages = allSitemapPages();
    const titles = new Set(pages.map((p) => p.title));
    const paths = new Set(pages.map((p) => p.path));
    expect(titles.size).toBe(pages.length);
    expect(paths.size).toBe(pages.length);
    expect(pages[0].path).toBe('/');
  });

  it('analysisMeta работает и для произвольного символа из URL', () => {
    const m = analysisMeta('tonusdt');
    expect(m.title).toContain('TON/USDT');
    expect(m.path).toBe('/analysis/TONUSDT'); // канонический верхний регистр
  });
});

describe('sitemap.xml', () => {
  const xml = buildSitemapXml();

  it('валидный XML-каркас sitemaps.org', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('содержит все страницы с полным https-URL', () => {
    for (const p of allSitemapPages()) {
      expect(xml).toContain(`<loc>${SITE_URL}${p.path}</loc>`);
    }
    expect(xml).toContain('<loc>https://kairi.pro/analysis/BTCUSDT</loc>');
  });

  it('нет дубликатов <loc>', () => {
    const locs = xml.match(/<loc>[^<]+<\/loc>/g) ?? [];
    expect(new Set(locs).size).toBe(locs.length);
  });
});
