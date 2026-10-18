// Универсальная сворачиваемая секция страницы анализа (запрос: «каждое окно
// анализа можно было сворачивать и разворачивать»).
//
// Особенности:
//  - состояние раскрытия НЕ хранится в стейте страницы, а пишется в localStorage
//    по стабильному key — выбор пользователя переживает перезагрузку и переходы;
//  - заголовок — кнопка (доступность: aria-expanded, Enter/Space);
//  - при сворачивании содержимое размонтируется (экономит SVG-рендер тяжёлых
//    панелей: профиль объёма, дельта, мульти-ТФ карта).

import { useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'nison:section:';

interface CollapsibleProps {
  /** Стабильный идентификатор секции для localStorage */
  storageKey: string;
  title: ReactNode;
  icon?: ReactNode;
  /** Краткая сводка, видимая даже в свёрнутом состоянии (например «3 сигнала · 2 подтверждено») */
  badge?: ReactNode;
  /** По умолчанию развёрнуто */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({ storageKey, title, icon, badge, defaultOpen = true, children }: CollapsibleProps) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      /* localStorage недоступен (SSR/приватный режим) — используем defaultOpen */
    }
    return defaultOpen;
  });

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, next ? '1' : '0');
      } catch {
        /* игнорируем — состояние останется только на время сессии */
      }
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-gray-800/60 bg-[#131a2b]/50">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left sm:px-6"
      >
        {/* Треугольник-шеврон: рисуется текстом, чтобы не тянуть лишние иконки */}
        <span className={`text-xs text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        {icon}
        <span className="text-sm font-semibold text-white sm:text-base">{title}</span>
        {badge && <span className="ml-1 flex flex-wrap items-center gap-2">{badge}</span>}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-600">
          {open ? 'свернуть' : 'развернуть'}
        </span>
      </button>
      {open && <div className="px-4 pb-4 sm:px-6 sm:pb-6">{children}</div>}
    </section>
  );
}
