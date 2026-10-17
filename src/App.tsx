import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import SignalJournal from './components/SignalJournal';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="analysis/:symbol" element={<Analysis />} />
          <Route path="journal" element={<SignalJournal />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
