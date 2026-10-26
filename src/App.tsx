import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';

// Code-splitting: тяжёлые страницы грузятся лениво отдельными чанками
const Analysis = lazy(() => import('./pages/Analysis'));
const SignalJournal = lazy(() => import('./components/SignalJournal'));
const BacktestPage = lazy(() => import('./pages/Backtest'));
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
          <Route
            path="pricing"
            element={
              <Suspense fallback={<PageFallback />}>
                <PricingPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
