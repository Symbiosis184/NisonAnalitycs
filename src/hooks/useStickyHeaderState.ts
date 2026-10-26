// Состояние «прилипшей» шапки страницы: появляется, когда пользователь
// прокрутил ниже родного заголовка (чтобы при просмотре карточки аналитики
// внизу страницы всегда было видно, какой инструмент и по какой цене открыт).
import { useEffect, useRef, useState } from 'react';

export function useStickyHeaderState(enabled = true) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setScrolledPast(false);
      return;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = anchorRef.current;
        if (!el) return;
        // Порог: высота фиксированной навигации (~64px) + небольшой запас.
        // Когда низ якоря уходит под шапку — включаем mini-заголовок.
        setScrolledPast(el.getBoundingClientRect().bottom < 72);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled]);

  return { anchorRef, scrolledPast };
}
