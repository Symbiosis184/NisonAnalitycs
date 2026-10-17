import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import SignalJournal from './components/SignalJournal';
import BacktestPage from './pages/Backtest';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="analysis/:symbol" element={<Analysis />} />
          <Route path="journal" element={<SignalJournal />} />
          <Route path="backtest" element={<BacktestPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
