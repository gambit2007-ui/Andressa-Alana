import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { LoadingState } from './components/ui';

const AuditPage = lazy(() => import('./features/audit/AuditPage'));
const ClientsPage = lazy(() => import('./features/clients/ClientsPage'));
const ContractsPage = lazy(() => import('./features/contracts/ContractsPage'));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const DevicesPage = lazy(() => import('./features/devices/DevicesPage'));
const FinancePage = lazy(() => import('./features/finance/FinancePage'));
const MdmPage = lazy(() => import('./features/mdm/MdmPage'));
const ProfitabilityPage = lazy(() => import('./features/profitability/ProfitabilityPage'));
const SalesPage = lazy(() => import('./features/sales/SalesPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingState label="Abrindo modulo..." />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="contracts" element={<ContractsPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="profitability" element={<ProfitabilityPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="mdm" element={<MdmPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
