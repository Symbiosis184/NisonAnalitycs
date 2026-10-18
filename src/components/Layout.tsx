import { Outlet, Link, useLocation } from 'react-router-dom';
import { BarChart3, TrendingUp, BookOpen, FlaskConical } from 'lucide-react';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#0a0e17] text-gray-100">
      <header className="border-b border-gray-800/60 bg-[#0d1321]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Nison <span className="text-amber-400">Analytics</span></span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 normal-case tracking-normal"
                    title={import.meta.env.VITE_APP_VERSION ? `v${import.meta.env.VITE_APP_VERSION}` : 'v1.0'}
                  >
                    v{import.meta.env.VITE_APP_VERSION || '1.0'}
                  </span>
                </h1>
                <p className="text-[10px] text-gray-500 -mt-0.5 tracking-wider uppercase">
                  Trading Dashboard
                </p>
              </div>
            </Link>

            <nav className="flex items-center gap-4">
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
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-800/60 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              © 2026 Nison Analytics v{import.meta.env.VITE_APP_VERSION || '1.0'}. Powered by Steve Nison's methodology.
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span>Data: Bybit API</span>
              <span>•</span>
              <span>Real-time updates</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
