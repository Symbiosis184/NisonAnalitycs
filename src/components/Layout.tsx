import { createContext, useContext, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { BarChart3, TrendingUp, BookOpen, FlaskConical, Heart, CreditCard } from 'lucide-react';
import SupportModal from './SupportModal';
import ContextMenu from './ContextMenu';
import { PRICING_ENABLED } from '../App';

// Mini-заголовок в шапке: страница аналитики публикует сюда пару и цену,
// когда пользователь прокрутил родной заголовок (см. Analysis.tsx).
export interface HeaderBadge {
  title: string;   // например "BTC/USDT · D"
  price: string;   // уже отформатированная цена, например "$112 340"
  positive?: boolean; // цвет цены по суточному изменению
}

interface HeaderBadgeCtx {
  badge: HeaderBadge | null;
  setBadge: (b: HeaderBadge | null) => void;
}

const HeaderBadgeContext = createContext<HeaderBadgeCtx>({ badge: null, setBadge: () => {} });

/** Страница может показать/скрыть mini-заголовок в шапке навигации. */
export function useHeaderBadge() {
  return useContext(HeaderBadgeContext);
}

export default function Layout() {
  const location = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const [badge, setBadge] = useState<HeaderBadge | null>(null);

  return (
    <HeaderBadgeContext.Provider value={{ badge, setBadge }}>
    <div className="min-h-screen bg-surface-deep text-gray-100">
      <header className="border-b border-gray-800/60 bg-surface-raised/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link to="/" className="flex items-center gap-2 sm:gap-3 group min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow flex-shrink-0">
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  {/* Обычное написание слова «Analytics» (финальное решение пользователя от 26.10: без свечи) */}
                  <span className="truncate">Kairi <span className="text-amber-400">Analytics</span></span>
                  <span
                    className="hidden sm:inline-flex text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 normal-case tracking-normal flex-shrink-0"
                    title={import.meta.env.VITE_APP_VERSION ? `v${import.meta.env.VITE_APP_VERSION}` : 'v1.0'}
                  >
                    v{import.meta.env.VITE_APP_VERSION || '1.0'}
                  </span>
                </h1>
                <p className="hidden sm:block text-[11px] text-gray-400 -mt-0.5 tracking-wider uppercase">
                  Trading Dashboard
                </p>
              </div>
            </Link>

            {/* Mini-заголовок: пара + цена, когда страница аналитики прокручена вниз */}
            {badge && (
              <div className="hidden sm:flex items-center gap-2 min-w-0 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/60 max-w-[46%]">
                <span className="text-xs font-semibold text-gray-300 whitespace-nowrap">{badge.title}</span>
                <span className={`text-sm font-bold tabular-nums truncate ${
                  badge.positive === undefined ? 'text-white' : badge.positive ? 'text-green-400' : 'text-red-400'
                }`}>{badge.price}</span>
              </div>
            )}

            {/* Десктопная навигация */}
            <nav className="hidden md:flex items-center gap-4">
              <Link
                to="/"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                Обзор
              </Link>
              <Link
                to="/journal"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/journal'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Журнал
              </Link>
              <Link
                to="/backtest"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/backtest'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <FlaskConical className="w-4 h-4" />
                Бэктест
              </Link>
              {/* Ссылка «Тарифы» скрыта, пока страница закрыта (PRICING_ENABLED=false в App.tsx) */}
              {PRICING_ENABLED && (
                <Link
                  to="/pricing"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === '/pricing'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  Тарифы
                </Link>
              )}
              <button
                onClick={() => setSupportOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
                title="Поддержать развитие проекта (TON)"
              >
                <span className="heart-beat"><Heart className="w-4 h-4 fill-current" /></span>
                Поддержать
              </button>
            </nav>

            {/* Мобильная строка версионного бейджа */}
            <span className="md:hidden text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex-shrink-0">
              v{import.meta.env.VITE_APP_VERSION || '1.0'}
            </span>
          </div>

          {/* Mini-заголовок на мобильных: пара + цена под шапкой, когда страница прокручена */}
          {badge && (
            <div className="md:hidden flex items-center gap-2 pb-2 min-w-0">
              <span className="text-xs font-semibold text-gray-300 whitespace-nowrap">{badge.title}</span>
              <span className={`text-sm font-bold tabular-nums ${
                badge.positive === undefined ? 'text-white' : badge.positive ? 'text-green-400' : 'text-red-400'
              }`}>{badge.price}</span>
            </div>
          )}

          {/* Мобильная горизонтальная навигация (под шапкой, скроллится) */}
          <nav className="md:hidden flex items-center gap-1 pb-2 overflow-x-auto -mx-3 px-3">
            <Link
              to="/"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                location.pathname === '/'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Обзор
            </Link>
            <Link
              to="/journal"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                location.pathname === '/journal'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Журнал
            </Link>
            <Link
              to="/backtest"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                location.pathname === '/backtest'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Бэктест
            </Link>
            {/* Ссылка «Тарифы» скрыта, пока страница закрыта (PRICING_ENABLED=false в App.tsx) */}
            {PRICING_ENABLED && (
              <Link
                to="/pricing"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  location.pathname === '/pricing'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                Тарифы
              </Link>
            )}
            <button
              onClick={() => setSupportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 flex-shrink-0"
            >
              <span className="heart-beat"><Heart className="w-3.5 h-3.5 fill-current" /></span>
              Поддержать
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-800/60 mt-10 sm:mt-16">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs sm:text-sm text-gray-400 text-center sm:text-left">
              © 2026 Kairi Analytics v{import.meta.env.VITE_APP_VERSION || '1.0'}. Powered by Steve Nison's methodology.
            </p>
            <div className="flex items-center gap-3 sm:gap-4 text-xs text-gray-600">
              <span>Data: Bybit API</span>
              <span>•</span>
              <span>Real-time updates</span>
              <span>•</span>
              <button
                onClick={() => setSupportOpen(true)}
                className="flex items-center gap-1.5 text-amber-400/80 hover:text-amber-300 transition-colors"
              >
                <span className="heart-beat"><Heart className="w-3.5 h-3.5 fill-current" /></span>
                Поддержать проект
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-between gap-x-4 gap-y-1 text-[11px] text-gray-600">
            <p>Сервис носит информационный характер и не является индивидуальной инвестиционной рекомендацией.</p>
            <nav aria-label="Правовые документы" className="flex items-center gap-3">
              <a href="/legal/terms.html" className="hover:text-gray-400 transition-colors">Публичная оферта</a>
              <span aria-hidden="true">•</span>
              <a href="/legal/privacy.html" className="hover:text-gray-400 transition-colors">Политика конфиденциальности</a>
            </nav>
          </div>
        </div>
      </footer>

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      <ContextMenu onSupport={() => setSupportOpen(true)} />
    </div>
    </HeaderBadgeContext.Provider>
  );
}
