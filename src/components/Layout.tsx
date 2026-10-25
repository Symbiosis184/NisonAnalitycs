import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { BarChart3, TrendingUp, BookOpen, FlaskConical, Heart } from 'lucide-react';
import SupportModal from './SupportModal';
import ContextMenu from './ContextMenu';

export default function Layout() {
  const location = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);

  return (
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
                  <span className="truncate">Kairi{' '}
                    {/* «Analytics»: буква i заменена горящей свечой той же высоты, что буква */}
                    <span className="text-amber-400" aria-hidden="true">
                      An
                      {/* i-свеча: инлайн-блок шириной/высотой со строчную букву (x-height), стоит на базовой линии; пламя — над ним */}
                      <span className="relative inline-block w-[0.24em] h-[0.52em] align-baseline ml-[0.03em] mr-[0.03em]">
                        {/* тело свечи = вертикальный штрих буквы i */}
                        <span className="absolute inset-0 rounded-[0.08em] bg-gradient-to-b from-amber-300 to-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.45)]" />
                        {/* фитилёк */}
                        <span className="absolute left-1/2 -translate-x-1/2 bottom-full h-[0.12em] w-[0.05em] bg-amber-400" />
                        {/* пламя (занимает место точки над i) */}
                        <span className="logo-flame absolute bottom-full right-1/2 translate-y-[0.08em] w-[0.34em] h-[0.42em] rounded-full bg-gradient-to-t from-orange-500 via-amber-400 to-yellow-200 blur-[0.5px]" />
                        {/* внутренний язычок */}
                        <span className="logo-spark absolute bottom-full right-1/2 translate-y-[0.14em] w-[0.14em] h-[0.2em] rounded-full bg-amber-100" />
                      </span>
                      nalytics
                    </span>
                    <span className="sr-only">Analytics</span>
                  </span>
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
              <button
                onClick={() => setSupportOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
                title="Поддержать развитие проекта (TON)"
              >
                <Heart className="w-4 h-4" />
                Поддержать
              </button>
            </nav>

            {/* Мобильная строка версионного бейджа */}
            <span className="md:hidden text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex-shrink-0">
              v{import.meta.env.VITE_APP_VERSION || '1.0'}
            </span>
          </div>

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
            <button
              onClick={() => setSupportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 flex-shrink-0"
            >
              <Heart className="w-3.5 h-3.5" />
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
                <Heart className="w-3.5 h-3.5" />
                Поддержать проект
              </button>
            </div>
          </div>
        </div>
      </footer>

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      <ContextMenu onSupport={() => setSupportOpen(true)} />
    </div>
  );
}
