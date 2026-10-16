import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Intake } from './pages/Intake';
import { Tanks } from './pages/Tanks';
import { Batches } from './pages/Batches';
import { BatchDetail } from './pages/BatchDetail';
import { Shifts } from './pages/Shifts';
import { QcChecks } from './pages/QcChecks';
import { Capa } from './pages/Capa';
import { Sales } from './pages/Sales';
import { ExitNote } from './pages/ExitNote';
import { Finance } from './pages/Finance';
import { Voucher } from './pages/Voucher';
import { Payroll } from './pages/Payroll';
import { Settings } from './pages/Settings';
import { ModuleManager } from './pages/ModuleManager';
import { ApiMonitor } from './pages/ApiMonitor';
import { Support } from './pages/Support';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/intake"
          element={
            <ProtectedRoute claim={['intake:read', 'intake:create']}>
              <Intake />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tanks"
          element={
            <ProtectedRoute claim="tanks:read">
              <Tanks />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches"
          element={
            <ProtectedRoute claim="batches:read">
              <Batches />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches/:id"
          element={
            <ProtectedRoute claim="batches:read">
              <BatchDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shifts"
          element={
            <ProtectedRoute claim="shifts:read">
              <Shifts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qc"
          element={
            <ProtectedRoute claim="qc:read">
              <QcChecks />
            </ProtectedRoute>
          }
        />
        <Route
          path="/capa"
          element={
            <ProtectedRoute claim="capa:read">
              <Capa />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales"
          element={
            <ProtectedRoute claim="sales:read">
              <Sales />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/dispatches/:id"
          element={
            <ProtectedRoute claim="sales:read">
              <ExitNote />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance"
          element={
            <ProtectedRoute claim="finance:read">
              <Finance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/vouchers/:id"
          element={
            <ProtectedRoute claim="finance:read">
              <Voucher />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payroll"
          element={
            <ProtectedRoute claim="payroll:read">
              <Payroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute claim="settings:read">
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/module-manager"
          element={
            <ProtectedRoute claim="settings:read">
              <ModuleManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/api-monitor"
          element={
            <ProtectedRoute claim="settings:read">
              <ApiMonitor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support"
          element={
            <ProtectedRoute claim="support:read">
              <Support />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}
