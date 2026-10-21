import { useEffect, useRef, useState } from 'react';
import { Share2, Heart } from 'lucide-react';

interface Props {
  /** Открыть модалку поддержки (кнопка «Поддержать» в шапке). */
  onSupport: () => void;
}

interface MenuState {
  x: number;
  y: number;
}

/** Делится ссылкой на текущую страницу: системный шаринг, иначе буфер обмена. */
async function shareProject() {
  const url = window.location.href;
  const data = { title: 'Nison Analytics', text: 'Анализ рынка по методу Стива Нисона', url };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
  } catch {
    /* пользователь отменил системный шаринг — молча выходим */
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* fallback для небезопасного контекста */
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

/**
 * Кастомное контекстное меню: блокирует стандартное меню браузера на всей
 * странице и показывает два пункта — «Поделиться» (ссылка на проект) и
 * «Поддержать» (модалка GRAM/TON).
 */
export default function ContextMenu({ onSupport }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Глобальный перехват правой кнопки мыши.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Меню ~220px ширины, ~96px высоты — не выпускаем за край экрана.
      const x = Math.min(e.clientX, vw - 236);
      const y = Math.min(e.clientY, vh - 110);
      setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
      setCopied(false);
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Закрытие по клику вне меню, Esc и прокрутке страницы.
  useEffect(() => {
    if (!menu) return;
    const closeOnOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const closeOnScroll = () => setMenu(null);
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEsc);
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEsc);
      window.removeEventListener('scroll', closeOnScroll);
    };
  }, [menu]);

  if (!menu) return null;

  const itemCls =
    'flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-200 hover:bg-amber-500/10 hover:text-amber-400 transition-colors cursor-pointer';

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Меню действий"
      className="fixed z-[100] min-w-[220px] rounded-xl border border-gray-700/70 bg-[#0d1321]/95 backdrop-blur-xl shadow-2xl shadow-black/50 py-1.5 animate-in"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={async () => {
          await shareProject();
          setCopied(true);
          setTimeout(() => setMenu(null), 700);
        }}
      >
        <Share2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
        {copied ? 'Ссылка скопирована ✓' : 'Поделиться'}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        onClick={() => {
          setMenu(null);
          onSupport();
        }}
      >
        <Heart className="w-4 h-4 text-rose-400 flex-shrink-0" />
        Поддержать
      </button>
      <div className="mt-1 px-3 pt-1.5 border-t border-gray-800/70 text-[10px] text-gray-500">
        Nison Analytics · правый клик отключён браузером
      </div>
    </div>
  );
}
