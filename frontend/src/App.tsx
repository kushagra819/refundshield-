import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { SkeletonCard } from './components/feedback';
import { Dashboard } from './pages/Dashboard';

// The dashboard is the landing route and ships eagerly. Everything else is
// split, so the first paint does not carry the graph, chart and table code.
const Investigations = lazy(() => import('./pages/Investigations').then((m) => ({ default: m.Investigations })));
const InvestigationDetail = lazy(() => import('./pages/InvestigationDetail').then((m) => ({ default: m.InvestigationDetail })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.AccountDetail })));
const NetworkExplorer = lazy(() => import('./pages/NetworkExplorer').then((m) => ({ default: m.NetworkExplorer })));
const ThresholdAnalysis = lazy(() => import('./pages/ThresholdAnalysis').then((m) => ({ default: m.ThresholdAnalysis })));
const Scenarios = lazy(() => import('./pages/Scenarios').then((m) => ({ default: m.Scenarios })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));

function RouteFallback() {
  return (
    <div className="space-y-4">
      <SkeletonCard lines={2} />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/investigations" element={<Investigations />} />
        <Route path="/investigations/:returnId" element={<InvestigationDetail />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:accountId" element={<AccountDetail />} />
        <Route path="/network" element={<NetworkExplorer />} />
        <Route path="/threshold" element={<ThresholdAnalysis />} />
        <Route path="/scenarios" element={<Scenarios />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}
