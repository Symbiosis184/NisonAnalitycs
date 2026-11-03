// i18n.ts — лёгкий контекст языка (RU/EN) без внешних зависимостей.
// Язык хранится в localStorage ('kairi-lang'), по умолчанию — по языку браузера.
// Все строки приложения изначально русские, поэтому t() = translateString():
// на ru возвращает исходную строку, на en — перевод из словаря (см. dictionaries.ts),
// а неизвестная строка остаётся русской (безопасный fallback).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { translateString, type Lang } from './dictionaries';

export type { Lang };

const STORAGE_KEY = 'kairi-lang';

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch { /* приватный режим браузера — идём дальше */ }
  // Язык браузера: 'en', 'en-US', 'ru-RU'...
  const nav = typeof navigator !== 'undefined' ? (navigator.language || 'ru') : 'ru';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Перевод строки: ru → как есть; en → словарь (fallback = оригинал). */
  t: (s: string) => string;
  /** Locale для toLocaleString/toLocaleTimeString (числа, время). */
  locale: string;
}

const I18nContext = createContext<I18nCtx>({
  lang: 'ru',
  setLang: () => {},
  t: (s: string) => s,
  locale: 'ru-RU',
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  // Синхронизируем <html lang> — полезно SEO и экранным дикторам.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18nCtx>(() => ({
    lang,
    setLang,
    t: (s: string) => translateString(s, lang),
    locale: lang === 'en' ? 'en-US' : 'ru-RU',
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Хук перевода: const { t, lang, setLang, locale } = useI18n(); */
export function useI18n(): I18nCtx {
  return useContext(I18nContext);
}
