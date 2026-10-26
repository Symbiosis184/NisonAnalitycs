import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
// Флаг доступа к странице «Тарифы». Страница закрыта до доработки приёма
// платежей: маршрутизация на /pricing отключена (см. ниже), ссылка в навигации
// не рендерится. Чтобы открыть тарифы после доработки — вернуть PRICING_ENABLED=true.
export const PRICING_ENABLED = false;

// Code-splitting: тяжёлые страницы грузятся лениво отдельными чанками
const Analysis = lazy(() => import('./pages/Analysis'));
const SignalJournal = lazy(() => import('./components/SignalJournal'));
const BacktestPage = lazy(() => import('./pages/Backtest'));
// Страница «Тарифы» временно закрыта (PRICING_ENABLED=false): lazy-импорт не
// выполняется, поэтому чанк Pricing даже не попадает в продакшн-сборку.
// Открыть: PRICING_ENABLED=true выше.
const PricingPage = lazy(() => import('./pages/Pricing'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-amber-500" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route
            path="analysis/:symbol"
            element={
              <Suspense fallback={<PageFallback />}>
                {/* Локальная граница ошибок: крах страницы анализа не убивает всё приложение */}
                <ErrorBoundary key="analysis">
                  <Analysis />
                </ErrorBoundary>
              </Suspense>
            }
          />
          <Route
            path="journal"
            element={
              <Suspense fallback={<PageFallback />}>
                <SignalJournal />
              </Suspense>
            }
          />
          <Route
            path="backtest"
            element={
              <Suspense fallback={<PageFallback />}>
                <BacktestPage />
              </Suspense>
            }
          />
          {/* Страница «Тарифы» закрыта до доработки: при PRICING_ENABLED=false
              маршрут не регистрируется, прямой заход на /pricing отдаёт 404-страницу. */}
          {PRICING_ENABLED && (
            <Route
              path="pricing"
              element={
                <Suspense fallback={<PageFallback />}>
                  <PricingPage />
                </Suspense>
              }
            />
          )}
          {!PRICING_ENABLED && (
            <Route
              path="pricing"
              element={
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <p className="text-gray-400 text-sm">Раздел временно недоступен — мы его дорабатываем.</p>
                  <Link to="/" className="text-amber-400 text-sm underline hover:text-amber-300">
                    Вернуться на обзор рынка
                  </Link>
                </div>
              }
            />
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
