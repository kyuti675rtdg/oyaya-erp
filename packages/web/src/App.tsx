import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Intake } from './pages/Intake';
import { Suppliers } from './pages/Suppliers';
import { PurchaseOrders } from './pages/PurchaseOrders';
import { IncomingInspection } from './pages/IncomingInspection';
import { AccountsPayable } from './pages/AccountsPayable';
import { ProcurementReports } from './pages/ProcurementReports';
import { Tanks } from './pages/Tanks';
import { DryStorage } from './pages/DryStorage';
import { TankFilling } from './pages/TankFilling';
import { BlendTracking } from './pages/BlendTracking';
import { ConditioningMonitor } from './pages/ConditioningMonitor';
import { TankRelease } from './pages/TankRelease';
import { StockMovement } from './pages/StockMovement';
import { StorageReports } from './pages/StorageReports';
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
// Module 4: Production & Milling
import { ProdProductionPlan } from './pages/ProdProductionPlan';
import { ProdWheatBlending } from './pages/ProdWheatBlending';
import { ProdWheatWashing } from './pages/ProdWheatWashing';
import { ProdMillingProcess } from './pages/ProdMillingProcess';
import { ProdDowntimeLogs } from './pages/ProdDowntimeLogs';
import { ProdFlourOutput } from './pages/ProdFlourOutput';
import { ProdYieldAlerts } from './pages/ProdYieldAlerts';
import { ProdProductionReports } from './pages/ProdProductionReports';
// Module 5: Quality Assurance
import { QualityStandards } from './pages/QualityStandards';
import { FlourQualityTesting } from './pages/FlourQualityTesting';
import { SamplingSchedule } from './pages/SamplingSchedule';
import { QualityApproval } from './pages/QualityApproval';
import { QualityReports } from './pages/QualityReports';
// Module 6: Nonconformity & CAPA
import { NcRegister } from './pages/NcRegister';
import { NcRootCause } from './pages/NcRootCause';
import { NcActions } from './pages/NcActions';
import { NcDisposition } from './pages/NcDisposition';
import { NcSignOff } from './pages/NcSignOff';
import { NcReports } from './pages/NcReports';
// Module 7: Sanitation & Hygiene
import { HygieneChecklists } from './pages/HygieneChecklists';
import { AreaCleaning } from './pages/AreaCleaning';
import { HygieneInspections } from './pages/HygieneInspections';
import { CleaningTracking } from './pages/CleaningTracking';
import { HygieneApproval } from './pages/HygieneApproval';
import { HygieneReports } from './pages/HygieneReports';
// Module 8: Pest Control
import { PestSchedule } from './pages/PestSchedule';
import { RiskAreaInspections } from './pages/RiskAreaInspections';
import { PestTreatments } from './pages/PestTreatments';
import { PestFollowUp } from './pages/PestFollowUp';
import { PestAlerts } from './pages/PestAlerts';
import { PestReports } from './pages/PestReports';
// Module 9: Maintenance
import { MaintPlanning } from './pages/MaintPlanning';
import { PreventiveChecklists } from './pages/PreventiveChecklists';
import { BreakdownRecords } from './pages/BreakdownRecords';
import { SpareParts } from './pages/SpareParts';
import { WorkOrders } from './pages/WorkOrders';
import { RepairApproval } from './pages/RepairApproval';
import { MaintReports } from './pages/MaintReports';
// Module 10: Finished Goods
import { FinishedGoods } from './pages/FinishedGoods';
import { FlourGrades } from './pages/FlourGrades';
import { PackagingOps } from './pages/PackagingOps';
import { BatchLabeling } from './pages/BatchLabeling';
import { ByproductInventory } from './pages/ByproductInventory';
import { StockAging } from './pages/StockAging';
import { FgReports } from './pages/FgReports';
// Module 11: Warehouse
import { WarehouseLocations } from './pages/WarehouseLocations';
import { PutAway } from './pages/PutAway';
import { StockTransfers } from './pages/StockTransfers';
import { InventoryAdjustments } from './pages/InventoryAdjustments';
import { StockReservation } from './pages/StockReservation';
import { StockDispatch } from './pages/StockDispatch';
import { Stocktaking } from './pages/Stocktaking';
import { InventoryReports } from './pages/InventoryReports';

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
          path="/incoming-inspection"
          element={
            <ProtectedRoute claim="procurement:view">
              <IncomingInspection />
            </ProtectedRoute>
          }
        />
        <Route
          path="/suppliers"
          element={
            <ProtectedRoute claim="procurement:view">
              <Suppliers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <ProtectedRoute claim="procurement:view">
              <PurchaseOrders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts-payable"
          element={
            <ProtectedRoute claim="procurement:view">
              <AccountsPayable />
            </ProtectedRoute>
          }
        />
        <Route
          path="/procurement-reports"
          element={
            <ProtectedRoute claim="procurement:view">
              <ProcurementReports />
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
          path="/dry-storage"
          element={
            <ProtectedRoute claim="tanks:read">
              <DryStorage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tank-filling"
          element={
            <ProtectedRoute claim="tanks:read">
              <TankFilling />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blend-tracking"
          element={
            <ProtectedRoute claim="tanks:read">
              <BlendTracking />
            </ProtectedRoute>
          }
        />
        <Route
          path="/conditioning-monitor"
          element={
            <ProtectedRoute claim="tanks:read">
              <ConditioningMonitor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tank-release"
          element={
            <ProtectedRoute claim="tanks:read">
              <TankRelease />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock-movement"
          element={
            <ProtectedRoute claim="tanks:read">
              <StockMovement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/storage-reports"
          element={
            <ProtectedRoute claim="tanks:read">
              <StorageReports />
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
        {/* ─── Module 4: Production & Milling ─── */}
        <Route path="/production-plans" element={<ProtectedRoute claim="production:view"><ProdProductionPlan /></ProtectedRoute>} />
        <Route path="/blend-recipes" element={<ProtectedRoute claim="production:view"><ProdWheatBlending /></ProtectedRoute>} />
        <Route path="/wheat-washing" element={<ProtectedRoute claim="production:view"><ProdWheatWashing /></ProtectedRoute>} />
        <Route path="/milling-process" element={<ProtectedRoute claim="production:view"><ProdMillingProcess /></ProtectedRoute>} />
        <Route path="/downtime" element={<ProtectedRoute claim="production:view"><ProdDowntimeLogs /></ProtectedRoute>} />
        <Route path="/flour-output" element={<ProtectedRoute claim="production:view"><ProdFlourOutput /></ProtectedRoute>} />
        <Route path="/yield-alerts" element={<ProtectedRoute claim="production:view"><ProdYieldAlerts /></ProtectedRoute>} />
        <Route path="/production-reports" element={<ProtectedRoute claim="production:view"><ProdProductionReports /></ProtectedRoute>} />
        {/* ─── Module 5: Quality Assurance ─── */}
        <Route path="/quality/standards" element={<ProtectedRoute claim="qc:view"><QualityStandards /></ProtectedRoute>} />
        <Route path="/quality/flour-tests" element={<ProtectedRoute claim="qc:view"><FlourQualityTesting /></ProtectedRoute>} />
        <Route path="/quality/sampling" element={<ProtectedRoute claim="qc:view"><SamplingSchedule /></ProtectedRoute>} />
        <Route path="/quality/approval" element={<ProtectedRoute claim="qc:view"><QualityApproval /></ProtectedRoute>} />
        <Route path="/quality/reports" element={<ProtectedRoute claim="qc:view"><QualityReports /></ProtectedRoute>} />
        {/* ─── Module 6: Nonconformity & CAPA ─── */}
        <Route path="/nc-register" element={<ProtectedRoute claim="capa:view"><NcRegister /></ProtectedRoute>} />
        <Route path="/nc-root-cause" element={<ProtectedRoute claim="capa:view"><NcRootCause /></ProtectedRoute>} />
        <Route path="/nc-actions" element={<ProtectedRoute claim="capa:view"><NcActions /></ProtectedRoute>} />
        <Route path="/nc-disposition" element={<ProtectedRoute claim="capa:view"><NcDisposition /></ProtectedRoute>} />
        <Route path="/nc-signoff" element={<ProtectedRoute claim="capa:view"><NcSignOff /></ProtectedRoute>} />
        <Route path="/nc-reports" element={<ProtectedRoute claim="capa:view"><NcReports /></ProtectedRoute>} />
        {/* ─── Module 7: Sanitation & Hygiene ─── */}
        <Route path="/hygiene/checklists" element={<ProtectedRoute claim="hygiene:view"><HygieneChecklists /></ProtectedRoute>} />
        <Route path="/hygiene/area-cleaning" element={<ProtectedRoute claim="hygiene:view"><AreaCleaning /></ProtectedRoute>} />
        <Route path="/hygiene/inspections" element={<ProtectedRoute claim="hygiene:view"><HygieneInspections /></ProtectedRoute>} />
        <Route path="/hygiene/actions" element={<ProtectedRoute claim="hygiene:view"><CleaningTracking /></ProtectedRoute>} />
        <Route path="/hygiene/approvals" element={<ProtectedRoute claim="hygiene:view"><HygieneApproval /></ProtectedRoute>} />
        <Route path="/hygiene/reports" element={<ProtectedRoute claim="hygiene:view"><HygieneReports /></ProtectedRoute>} />
        {/* ─── Module 8: Pest Control ─── */}
        <Route path="/pest/schedule" element={<ProtectedRoute claim="pest:view"><PestSchedule /></ProtectedRoute>} />
        <Route path="/pest/risk-inspections" element={<ProtectedRoute claim="pest:view"><RiskAreaInspections /></ProtectedRoute>} />
        <Route path="/pest/treatments" element={<ProtectedRoute claim="pest:view"><PestTreatments /></ProtectedRoute>} />
        <Route path="/pest/follow-ups" element={<ProtectedRoute claim="pest:view"><PestFollowUp /></ProtectedRoute>} />
        <Route path="/pest/alerts" element={<ProtectedRoute claim="pest:view"><PestAlerts /></ProtectedRoute>} />
        <Route path="/pest/reports" element={<ProtectedRoute claim="pest:view"><PestReports /></ProtectedRoute>} />
        {/* ─── Module 9: Maintenance ─── */}
        <Route path="/maintenance/planning" element={<ProtectedRoute claim="maintenance:view"><MaintPlanning /></ProtectedRoute>} />
        <Route path="/maintenance/pm-checklists" element={<ProtectedRoute claim="maintenance:view"><PreventiveChecklists /></ProtectedRoute>} />
        <Route path="/maintenance/breakdowns" element={<ProtectedRoute claim="maintenance:view"><BreakdownRecords /></ProtectedRoute>} />
        <Route path="/maintenance/spare-parts" element={<ProtectedRoute claim="maintenance:view"><SpareParts /></ProtectedRoute>} />
        <Route path="/maintenance/work-orders" element={<ProtectedRoute claim="maintenance:view"><WorkOrders /></ProtectedRoute>} />
        <Route path="/maintenance/repair-approval" element={<ProtectedRoute claim="maintenance:view"><RepairApproval /></ProtectedRoute>} />
        <Route path="/maintenance/reports" element={<ProtectedRoute claim="maintenance:view"><MaintReports /></ProtectedRoute>} />
        {/* ─── Module 10: Finished Goods ─── */}
        <Route path="/fg" element={<ProtectedRoute claim="fg:view"><FinishedGoods /></ProtectedRoute>} />
        <Route path="/fg/grades" element={<ProtectedRoute claim="fg:view"><FlourGrades /></ProtectedRoute>} />
        <Route path="/fg/packaging" element={<ProtectedRoute claim="fg:view"><PackagingOps /></ProtectedRoute>} />
        <Route path="/fg/labels" element={<ProtectedRoute claim="fg:view"><BatchLabeling /></ProtectedRoute>} />
        <Route path="/fg/byproducts" element={<ProtectedRoute claim="fg:view"><ByproductInventory /></ProtectedRoute>} />
        <Route path="/fg/aging" element={<ProtectedRoute claim="fg:view"><StockAging /></ProtectedRoute>} />
        <Route path="/fg/reports" element={<ProtectedRoute claim="fg:view"><FgReports /></ProtectedRoute>} />
        {/* ─── Module 11: Warehouse ─── */}
        <Route path="/warehouse/locations" element={<ProtectedRoute claim="warehouse:view"><WarehouseLocations /></ProtectedRoute>} />
        <Route path="/warehouse/putaway" element={<ProtectedRoute claim="warehouse:view"><PutAway /></ProtectedRoute>} />
        <Route path="/warehouse/transfers" element={<ProtectedRoute claim="warehouse:view"><StockTransfers /></ProtectedRoute>} />
        <Route path="/warehouse/adjustments" element={<ProtectedRoute claim="warehouse:view"><InventoryAdjustments /></ProtectedRoute>} />
        <Route path="/warehouse/reservations" element={<ProtectedRoute claim="warehouse:view"><StockReservation /></ProtectedRoute>} />
        <Route path="/warehouse/dispatch" element={<ProtectedRoute claim="warehouse:view"><StockDispatch /></ProtectedRoute>} />
        <Route path="/warehouse/stocktaking" element={<ProtectedRoute claim="warehouse:view"><Stocktaking /></ProtectedRoute>} />
        <Route path="/warehouse/reports" element={<ProtectedRoute claim="warehouse:view"><InventoryReports /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}
