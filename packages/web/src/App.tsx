import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './lib/theme';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Intake = lazy(() => import('./pages/Intake').then((m) => ({ default: m.Intake })));
const Suppliers = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.Suppliers })));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders').then((m) => ({ default: m.PurchaseOrders })));
const IncomingInspection = lazy(() => import('./pages/IncomingInspection').then((m) => ({ default: m.IncomingInspection })));
const AccountsPayable = lazy(() => import('./pages/AccountsPayable').then((m) => ({ default: m.AccountsPayable })));
const ProcurementReports = lazy(() => import('./pages/ProcurementReports').then((m) => ({ default: m.ProcurementReports })));
const Tanks = lazy(() => import('./pages/Tanks').then((m) => ({ default: m.Tanks })));
const DryStorage = lazy(() => import('./pages/DryStorage').then((m) => ({ default: m.DryStorage })));
const TankFilling = lazy(() => import('./pages/TankFilling').then((m) => ({ default: m.TankFilling })));
const BlendTracking = lazy(() => import('./pages/BlendTracking').then((m) => ({ default: m.BlendTracking })));
const ConditioningMonitor = lazy(() => import('./pages/ConditioningMonitor').then((m) => ({ default: m.ConditioningMonitor })));
const TankRelease = lazy(() => import('./pages/TankRelease').then((m) => ({ default: m.TankRelease })));
const StockMovement = lazy(() => import('./pages/StockMovement').then((m) => ({ default: m.StockMovement })));
const StorageReports = lazy(() => import('./pages/StorageReports').then((m) => ({ default: m.StorageReports })));
const Batches = lazy(() => import('./pages/Batches').then((m) => ({ default: m.Batches })));
const BatchDetail = lazy(() => import('./pages/BatchDetail').then((m) => ({ default: m.BatchDetail })));
const Shifts = lazy(() => import('./pages/Shifts').then((m) => ({ default: m.Shifts })));
const QcChecks = lazy(() => import('./pages/QcChecks').then((m) => ({ default: m.QcChecks })));
const Capa = lazy(() => import('./pages/Capa').then((m) => ({ default: m.Capa })));
const Sales = lazy(() => import('./pages/Sales').then((m) => ({ default: m.Sales })));
const ExitNote = lazy(() => import('./pages/ExitNote').then((m) => ({ default: m.ExitNote })));
const SalesAgreements = lazy(() => import('./pages/SalesAgreements').then((m) => ({ default: m.SalesAgreements })));
const SalesAdvances = lazy(() => import('./pages/SalesAdvances').then((m) => ({ default: m.SalesAdvances })));
const SalesLoading = lazy(() => import('./pages/SalesLoading').then((m) => ({ default: m.SalesLoading })));
const LoadConsolidation = lazy(() => import('./pages/LoadConsolidation').then((m) => ({ default: m.LoadConsolidation })));
const DeliveryTrips = lazy(() => import('./pages/DeliveryTrips').then((m) => ({ default: m.DeliveryTrips })));
const AgentStock = lazy(() => import('./pages/AgentStock').then((m) => ({ default: m.AgentStock })));
const SalesInvoices = lazy(() => import('./pages/SalesInvoices').then((m) => ({ default: m.SalesInvoices })));
const CashReconciliation = lazy(() => import('./pages/CashReconciliation').then((m) => ({ default: m.CashReconciliation })));
const SalesReports = lazy(() => import('./pages/SalesReports').then((m) => ({ default: m.SalesReports })));
const Finance = lazy(() => import('./pages/Finance').then((m) => ({ default: m.Finance })));
import { Voucher, Vouchers } from './pages/Voucher';
const ChartOfAccounts = lazy(() => import('./pages/ChartOfAccounts').then((m) => ({ default: m.ChartOfAccounts })));
const GeneralLedger = lazy(() => import('./pages/GeneralLedger').then((m) => ({ default: m.GeneralLedger })));
const FinanceAP = lazy(() => import('./pages/FinanceAP').then((m) => ({ default: m.FinanceAP })));
const FinanceAR = lazy(() => import('./pages/FinanceAR').then((m) => ({ default: m.FinanceAR })));
const CashBank = lazy(() => import('./pages/CashBank').then((m) => ({ default: m.CashBank })));
const Expenses = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.Expenses })));
const PayrollJournal = lazy(() => import('./pages/PayrollJournal').then((m) => ({ default: m.PayrollJournal })));
const TrialBalance = lazy(() => import('./pages/TrialBalance').then((m) => ({ default: m.TrialBalance })));
const IncomeStatement = lazy(() => import('./pages/IncomeStatement').then((m) => ({ default: m.IncomeStatement })));
const BalanceSheet = lazy(() => import('./pages/BalanceSheet').then((m) => ({ default: m.BalanceSheet })));
const FinancialReports = lazy(() => import('./pages/FinancialReports').then((m) => ({ default: m.FinancialReports })));
const Payroll = lazy(() => import('./pages/Payroll').then((m) => ({ default: m.Payroll })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const ModuleManager = lazy(() => import('./pages/ModuleManager').then((m) => ({ default: m.ModuleManager })));
const ApiMonitor = lazy(() => import('./pages/ApiMonitor').then((m) => ({ default: m.ApiMonitor })));
const Support = lazy(() => import('./pages/Support').then((m) => ({ default: m.Support })));
const TeamChat = lazy(() => import('./pages/chat/TeamChat').then((m) => ({ default: m.TeamChat })));
const ChatAdmin = lazy(() => import('./pages/chat/ChatAdmin').then((m) => ({ default: m.ChatAdmin })));
// Module 19: Support & Documentation Center
const Manuals = lazy(() => import('./pages/Manuals').then((m) => ({ default: m.Manuals })));
const SOPs = lazy(() => import('./pages/SOPs').then((m) => ({ default: m.SOPs })));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase').then((m) => ({ default: m.KnowledgeBase })));
const Tickets = lazy(() => import('./pages/Tickets').then((m) => ({ default: m.Tickets })));
const TechSupport = lazy(() => import('./pages/TechSupport').then((m) => ({ default: m.TechSupport })));
const Announcements = lazy(() => import('./pages/Announcements').then((m) => ({ default: m.Announcements })));
const Documents = lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })));
const DocFolders = lazy(() => import('./pages/DocFolders').then((m) => ({ default: m.DocFolders })));
const DocVersions = lazy(() => import('./pages/DocVersions').then((m) => ({ default: m.DocVersions })));
const DocApprovals = lazy(() => import('./pages/DocApprovals').then((m) => ({ default: m.DocApprovals })));
const DocTemplates = lazy(() => import('./pages/DocTemplates').then((m) => ({ default: m.DocTemplates })));
const DocArchive = lazy(() => import('./pages/DocArchive').then((m) => ({ default: m.DocArchive })));
const DocSharing = lazy(() => import('./pages/DocSharing').then((m) => ({ default: m.DocSharing })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })));
// Module 18: System Administration & Settings
const UserManagement = lazy(() => import('./pages/UserManagement').then((m) => ({ default: m.UserManagement })));
const RoleManagement = lazy(() => import('./pages/RoleManagement').then((m) => ({ default: m.RoleManagement })));
const SecuritySettings = lazy(() => import('./pages/SecuritySettings').then((m) => ({ default: m.SecuritySettings })));
const ApiHealth = lazy(() => import('./pages/ApiHealth').then((m) => ({ default: m.ApiHealth })));
const Webhooks = lazy(() => import('./pages/Webhooks').then((m) => ({ default: m.Webhooks })));
const NotificationSettings = lazy(() => import('./pages/NotificationSettings').then((m) => ({ default: m.NotificationSettings })));
const AuditLogs = lazy(() => import('./pages/AuditLogs').then((m) => ({ default: m.AuditLogs })));
const BackupManagement = lazy(() => import('./pages/BackupManagement').then((m) => ({ default: m.BackupManagement })));
// Module 4: Production & Milling
const ProdProductionPlan = lazy(() => import('./pages/ProdProductionPlan').then((m) => ({ default: m.ProdProductionPlan })));
const ProdWheatBlending = lazy(() => import('./pages/ProdWheatBlending').then((m) => ({ default: m.ProdWheatBlending })));
const ProdWheatWashing = lazy(() => import('./pages/ProdWheatWashing').then((m) => ({ default: m.ProdWheatWashing })));
const ProdMillingProcess = lazy(() => import('./pages/ProdMillingProcess').then((m) => ({ default: m.ProdMillingProcess })));
const ProdDowntimeLogs = lazy(() => import('./pages/ProdDowntimeLogs').then((m) => ({ default: m.ProdDowntimeLogs })));
const ProdFlourOutput = lazy(() => import('./pages/ProdFlourOutput').then((m) => ({ default: m.ProdFlourOutput })));
const ProdYieldAlerts = lazy(() => import('./pages/ProdYieldAlerts').then((m) => ({ default: m.ProdYieldAlerts })));
const ProdProductionReports = lazy(() => import('./pages/ProdProductionReports').then((m) => ({ default: m.ProdProductionReports })));
// Module 5: Quality Assurance
const QualityStandards = lazy(() => import('./pages/QualityStandards').then((m) => ({ default: m.QualityStandards })));
const FlourQualityTesting = lazy(() => import('./pages/FlourQualityTesting').then((m) => ({ default: m.FlourQualityTesting })));
const SamplingSchedule = lazy(() => import('./pages/SamplingSchedule').then((m) => ({ default: m.SamplingSchedule })));
const QualityApproval = lazy(() => import('./pages/QualityApproval').then((m) => ({ default: m.QualityApproval })));
const QualityReports = lazy(() => import('./pages/QualityReports').then((m) => ({ default: m.QualityReports })));
// Module 6: Nonconformity & CAPA
const NcRegister = lazy(() => import('./pages/NcRegister').then((m) => ({ default: m.NcRegister })));
const NcRootCause = lazy(() => import('./pages/NcRootCause').then((m) => ({ default: m.NcRootCause })));
const NcActions = lazy(() => import('./pages/NcActions').then((m) => ({ default: m.NcActions })));
const NcDisposition = lazy(() => import('./pages/NcDisposition').then((m) => ({ default: m.NcDisposition })));
const NcSignOff = lazy(() => import('./pages/NcSignOff').then((m) => ({ default: m.NcSignOff })));
const NcReports = lazy(() => import('./pages/NcReports').then((m) => ({ default: m.NcReports })));
// Module 7: Sanitation & Hygiene
const HygieneChecklists = lazy(() => import('./pages/HygieneChecklists').then((m) => ({ default: m.HygieneChecklists })));
const AreaCleaning = lazy(() => import('./pages/AreaCleaning').then((m) => ({ default: m.AreaCleaning })));
const HygieneInspections = lazy(() => import('./pages/HygieneInspections').then((m) => ({ default: m.HygieneInspections })));
const CleaningTracking = lazy(() => import('./pages/CleaningTracking').then((m) => ({ default: m.CleaningTracking })));
const HygieneApproval = lazy(() => import('./pages/HygieneApproval').then((m) => ({ default: m.HygieneApproval })));
const HygieneReports = lazy(() => import('./pages/HygieneReports').then((m) => ({ default: m.HygieneReports })));
// Module 8: Pest Control
const PestSchedule = lazy(() => import('./pages/PestSchedule').then((m) => ({ default: m.PestSchedule })));
const RiskAreaInspections = lazy(() => import('./pages/RiskAreaInspections').then((m) => ({ default: m.RiskAreaInspections })));
const PestTreatments = lazy(() => import('./pages/PestTreatments').then((m) => ({ default: m.PestTreatments })));
const PestFollowUp = lazy(() => import('./pages/PestFollowUp').then((m) => ({ default: m.PestFollowUp })));
const PestAlerts = lazy(() => import('./pages/PestAlerts').then((m) => ({ default: m.PestAlerts })));
const PestReports = lazy(() => import('./pages/PestReports').then((m) => ({ default: m.PestReports })));
// Module 9: Maintenance
const MaintPlanning = lazy(() => import('./pages/MaintPlanning').then((m) => ({ default: m.MaintPlanning })));
const PreventiveChecklists = lazy(() => import('./pages/PreventiveChecklists').then((m) => ({ default: m.PreventiveChecklists })));
const BreakdownRecords = lazy(() => import('./pages/BreakdownRecords').then((m) => ({ default: m.BreakdownRecords })));
const SpareParts = lazy(() => import('./pages/SpareParts').then((m) => ({ default: m.SpareParts })));
const WorkOrders = lazy(() => import('./pages/WorkOrders').then((m) => ({ default: m.WorkOrders })));
const RepairApproval = lazy(() => import('./pages/RepairApproval').then((m) => ({ default: m.RepairApproval })));
const MaintReports = lazy(() => import('./pages/MaintReports').then((m) => ({ default: m.MaintReports })));
// Module 10: Finished Goods
const FinishedGoods = lazy(() => import('./pages/FinishedGoods').then((m) => ({ default: m.FinishedGoods })));
const FlourGrades = lazy(() => import('./pages/FlourGrades').then((m) => ({ default: m.FlourGrades })));
const PackagingOps = lazy(() => import('./pages/PackagingOps').then((m) => ({ default: m.PackagingOps })));
const BatchLabeling = lazy(() => import('./pages/BatchLabeling').then((m) => ({ default: m.BatchLabeling })));
const ByproductInventory = lazy(() => import('./pages/ByproductInventory').then((m) => ({ default: m.ByproductInventory })));
const StockAging = lazy(() => import('./pages/StockAging').then((m) => ({ default: m.StockAging })));
const FgReports = lazy(() => import('./pages/FgReports').then((m) => ({ default: m.FgReports })));
// Module 12: Product Traceability
const TraceIntake = lazy(() => import('./pages/TraceIntake').then((m) => ({ default: m.TraceIntake })));
const TraceTank = lazy(() => import('./pages/TraceTank').then((m) => ({ default: m.TraceTank })));
const TraceBatch = lazy(() => import('./pages/TraceBatch').then((m) => ({ default: m.TraceBatch })));
const TraceFinished = lazy(() => import('./pages/TraceFinished').then((m) => ({ default: m.TraceFinished })));
const TraceQuality = lazy(() => import('./pages/TraceQuality').then((m) => ({ default: m.TraceQuality })));
const BatchRecall = lazy(() => import('./pages/BatchRecall').then((m) => ({ default: m.BatchRecall })));
const TraceSearch = lazy(() => import('./pages/TraceSearch').then((m) => ({ default: m.TraceSearch })));
// Module 11: Warehouse
const WarehouseLocations = lazy(() => import('./pages/WarehouseLocations').then((m) => ({ default: m.WarehouseLocations })));const PutAway = lazy(() => import('./pages/PutAway').then((m) => ({ default: m.PutAway })));
const StockTransfers = lazy(() => import('./pages/StockTransfers').then((m) => ({ default: m.StockTransfers })));
const InventoryAdjustments = lazy(() => import('./pages/InventoryAdjustments').then((m) => ({ default: m.InventoryAdjustments })));
const StockReservation = lazy(() => import('./pages/StockReservation').then((m) => ({ default: m.StockReservation })));
const StockDispatch = lazy(() => import('./pages/StockDispatch').then((m) => ({ default: m.StockDispatch })));
const Stocktaking = lazy(() => import('./pages/Stocktaking').then((m) => ({ default: m.Stocktaking })));
const InventoryReports = lazy(() => import('./pages/InventoryReports').then((m) => ({ default: m.InventoryReports })));
// Module 15: HR & Payroll
const Employees = lazy(() => import('./pages/Employees').then((m) => ({ default: m.Employees })));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail').then((m) => ({ default: m.EmployeeDetail })));
const Departments = lazy(() => import('./pages/Departments').then((m) => ({ default: m.Departments })));
const Attendance = lazy(() => import('./pages/Attendance').then((m) => ({ default: m.Attendance })));
const FixedPayroll = lazy(() => import('./pages/FixedPayroll').then((m) => ({ default: m.FixedPayroll })));
const PieceRatePayroll = lazy(() => import('./pages/PieceRatePayroll').then((m) => ({ default: m.PieceRatePayroll })));
const DriverPayroll = lazy(() => import('./pages/DriverPayroll').then((m) => ({ default: m.DriverPayroll })));
// Module 16: Fleet & Logistics
const Vehicles = lazy(() => import('./pages/Vehicles').then((m) => ({ default: m.Vehicles })));
const VehicleContracts = lazy(() => import('./pages/VehicleContracts').then((m) => ({ default: m.VehicleContracts })));
const DriverAssignment = lazy(() => import('./pages/DriverAssignment').then((m) => ({ default: m.DriverAssignment })));
const FleetTrips = lazy(() => import('./pages/FleetTrips').then((m) => ({ default: m.FleetTrips })));
const FleetUtilization = lazy(() => import('./pages/FleetUtilization').then((m) => ({ default: m.FleetUtilization })));
const FleetFuel = lazy(() => import('./pages/FleetFuel').then((m) => ({ default: m.FleetFuel })));
const FleetMaintenance = lazy(() => import('./pages/FleetMaintenance').then((m) => ({ default: m.FleetMaintenance })));
const FleetReports = lazy(() => import('./pages/FleetReports').then((m) => ({ default: m.FleetReports })));
const AllowancesDeductions = lazy(() => import('./pages/AllowancesDeductions').then((m) => ({ default: m.AllowancesDeductions })));
const PayrollProcessing = lazy(() => import('./pages/PayrollProcessing').then((m) => ({ default: m.PayrollProcessing })));
const Payslips = lazy(() => import('./pages/Payslips').then((m) => ({ default: m.Payslips })));
// Module 17: Business Intelligence
const BiProduction = lazy(() => import('./pages/bi/BiProduction').then((m) => ({ default: m.BiProduction })));
const BiQuality = lazy(() => import('./pages/bi/BiQuality').then((m) => ({ default: m.BiQuality })));
const BiProcurement = lazy(() => import('./pages/bi/BiProcurement').then((m) => ({ default: m.BiProcurement })));
const BiInventory = lazy(() => import('./pages/bi/BiInventory').then((m) => ({ default: m.BiInventory })));
const BiSales = lazy(() => import('./pages/bi/BiSales').then((m) => ({ default: m.BiSales })));
const BiFinance = lazy(() => import('./pages/bi/BiFinance').then((m) => ({ default: m.BiFinance })));
const BiHr = lazy(() => import('./pages/bi/BiHr').then((m) => ({ default: m.BiHr })));
const ReportBuilder = lazy(() => import('./pages/bi/ReportBuilder').then((m) => ({ default: m.ReportBuilder })));

export function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" /></div>}>
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
          path="/sales/agreements"
          element={
            <ProtectedRoute claim="sales:read">
              <SalesAgreements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/advances"
          element={
            <ProtectedRoute claim="sales:read">
              <SalesAdvances />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/loading"
          element={
            <ProtectedRoute claim="sales:read">
              <SalesLoading />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/consolidation"
          element={
            <ProtectedRoute claim="sales:read">
              <LoadConsolidation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/trips"
          element={
            <ProtectedRoute claim="sales:read">
              <DeliveryTrips />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/agents"
          element={
            <ProtectedRoute claim="sales:read">
              <AgentStock />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/invoices"
          element={
            <ProtectedRoute claim="sales:read">
              <SalesInvoices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/cash"
          element={
            <ProtectedRoute claim="sales:read">
              <CashReconciliation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/reports"
          element={
            <ProtectedRoute claim="sales:read">
              <SalesReports />
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
          path="/finance/chart-of-accounts"
          element={
            <ProtectedRoute claim="finance:read">
              <ChartOfAccounts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/ledger"
          element={
            <ProtectedRoute claim="finance:read">
              <GeneralLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/accounts-payable"
          element={
            <ProtectedRoute claim="finance:read">
              <FinanceAP />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/accounts-receivable"
          element={
            <ProtectedRoute claim="finance:read">
              <FinanceAR />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/cash-bank"
          element={
            <ProtectedRoute claim="finance:read">
              <CashBank />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/vouchers"
          element={
            <ProtectedRoute claim={['finance:read', 'finance:create']}>
              <Vouchers />
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
          path="/finance/expenses"
          element={
            <ProtectedRoute claim={['finance:read', 'finance:create']}>
              <Expenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/payroll-journal"
          element={
            <ProtectedRoute claim={['finance:read', 'finance:approve']}>
              <PayrollJournal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/trial-balance"
          element={
            <ProtectedRoute claim="finance:read">
              <TrialBalance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/income-statement"
          element={
            <ProtectedRoute claim="finance:read">
              <IncomeStatement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/balance-sheet"
          element={
            <ProtectedRoute claim="finance:read">
              <BalanceSheet />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/reports"
          element={
            <ProtectedRoute claim="finance:read">
              <FinancialReports />
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
          path="/hr/employees"
          element={
            <ProtectedRoute claim="hr:read">
              <Employees />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/employees/:id"
          element={
            <ProtectedRoute claim="hr:read">
              <EmployeeDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/departments"
          element={
            <ProtectedRoute claim="hr:read">
              <Departments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/attendance"
          element={
            <ProtectedRoute claim="hr:read">
              <Attendance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/fixed-payroll"
          element={
            <ProtectedRoute claim="hr:read">
              <FixedPayroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/piece-rate"
          element={
            <ProtectedRoute claim="hr:read">
              <PieceRatePayroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/driver-payroll"
          element={
            <ProtectedRoute claim="hr:read">
              <DriverPayroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/allowances"
          element={
            <ProtectedRoute claim="hr:read">
              <AllowancesDeductions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/payroll-run"
          element={
            <ProtectedRoute claim={['hr:read', 'hr:approve']}>
              <PayrollProcessing />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hr/payslips"
          element={
            <ProtectedRoute claim="hr:read">
              <Payslips />
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
          path="/admin/users"
          element={
            <ProtectedRoute claim="settings:read">
              <UserManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <ProtectedRoute claim="settings:read">
              <RoleManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/security"
          element={
            <ProtectedRoute claim="settings:read">
              <SecuritySettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/api-health"
          element={
            <ProtectedRoute claim="settings:read">
              <ApiHealth />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/webhooks"
          element={
            <ProtectedRoute claim="settings:read">
              <Webhooks />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <ProtectedRoute claim="settings:read">
              <NotificationSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute claim="settings:read">
              <AuditLogs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/backup"
          element={
            <ProtectedRoute claim="settings:read">
              <BackupManagement />
            </ProtectedRoute>
          }
        />
        <Route path="/fleet/vehicles" element={<ProtectedRoute claim="fleet:view"><Vehicles /></ProtectedRoute>} />
        <Route path="/fleet/contracts" element={<ProtectedRoute claim="fleet:view"><VehicleContracts /></ProtectedRoute>} />
        <Route path="/fleet/drivers" element={<ProtectedRoute claim="fleet:view"><DriverAssignment /></ProtectedRoute>} />
        <Route path="/fleet/trips" element={<ProtectedRoute claim="fleet:view"><FleetTrips /></ProtectedRoute>} />
        <Route path="/fleet/utilization" element={<ProtectedRoute claim="fleet:view"><FleetUtilization /></ProtectedRoute>} />
        <Route path="/fleet/fuel" element={<ProtectedRoute claim="fleet:view"><FleetFuel /></ProtectedRoute>} />
        <Route path="/fleet/maintenance" element={<ProtectedRoute claim="fleet:view"><FleetMaintenance /></ProtectedRoute>} />
        <Route path="/fleet/reports" element={<ProtectedRoute claim="fleet:view"><FleetReports /></ProtectedRoute>} />
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
          path="/chat"
          element={
            <ProtectedRoute claim="chat:view">
              <TeamChat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/admin"
          element={
            <ProtectedRoute claim="chat:manage">
              <ChatAdmin />
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
          path="/support/manuals"
          element={
            <ProtectedRoute claim="support:read">
              <Manuals />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/sops"
          element={
            <ProtectedRoute claim="support:read">
              <SOPs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/knowledge-base"
          element={
            <ProtectedRoute claim="support:read">
              <KnowledgeBase />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/tickets"
          element={
            <ProtectedRoute claim="support:read">
              <Tickets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/tech-support"
          element={
            <ProtectedRoute claim="support:read">
              <TechSupport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/announcements"
          element={
            <ProtectedRoute claim="support:read">
              <Announcements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/notifications"
          element={
            <ProtectedRoute claim="support:read">
              <Notifications />
            </ProtectedRoute>
          }
        />

        {/* ─── Module 20: Document Management ─── */}
        <Route path="/documents" element={<ProtectedRoute claim="documents:view"><Documents /></ProtectedRoute>} />
        <Route path="/documents/folders" element={<ProtectedRoute claim="documents:view"><DocFolders /></ProtectedRoute>} />
        <Route path="/documents/versions" element={<ProtectedRoute claim="documents:view"><DocVersions /></ProtectedRoute>} />
        <Route path="/documents/approvals" element={<ProtectedRoute claim="documents:view"><DocApprovals /></ProtectedRoute>} />
        <Route path="/documents/templates" element={<ProtectedRoute claim="documents:view"><DocTemplates /></ProtectedRoute>} />
        <Route path="/documents/archive" element={<ProtectedRoute claim="documents:view"><DocArchive /></ProtectedRoute>} />
        <Route path="/documents/sharing" element={<ProtectedRoute claim="documents:view"><DocSharing /></ProtectedRoute>} />

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
        {/* ─── Module 17: Business Intelligence (role-aware: pages render their own no-access state) ─── */}
        <Route path="/bi/production" element={<ProtectedRoute><BiProduction /></ProtectedRoute>} />
        <Route path="/bi/quality" element={<ProtectedRoute><BiQuality /></ProtectedRoute>} />
        <Route path="/bi/procurement" element={<ProtectedRoute><BiProcurement /></ProtectedRoute>} />
        <Route path="/bi/inventory" element={<ProtectedRoute><BiInventory /></ProtectedRoute>} />
        <Route path="/bi/sales" element={<ProtectedRoute><BiSales /></ProtectedRoute>} />
        <Route path="/bi/finance" element={<ProtectedRoute><BiFinance /></ProtectedRoute>} />
        <Route path="/bi/hr" element={<ProtectedRoute><BiHr /></ProtectedRoute>} />
        <Route path="/bi/report-builder" element={<ProtectedRoute><ReportBuilder /></ProtectedRoute>} />
        {/* ─── Module 11: Warehouse ─── */}
        <Route path="/warehouse/locations" element={<ProtectedRoute claim="warehouse:view"><WarehouseLocations /></ProtectedRoute>} />
        <Route path="/warehouse/putaway" element={<ProtectedRoute claim="warehouse:view"><PutAway /></ProtectedRoute>} />
        <Route path="/warehouse/transfers" element={<ProtectedRoute claim="warehouse:view"><StockTransfers /></ProtectedRoute>} />
        <Route path="/warehouse/adjustments" element={<ProtectedRoute claim="warehouse:view"><InventoryAdjustments /></ProtectedRoute>} />
        <Route path="/warehouse/reservations" element={<ProtectedRoute claim="warehouse:view"><StockReservation /></ProtectedRoute>} />
        <Route path="/warehouse/dispatch" element={<ProtectedRoute claim="warehouse:view"><StockDispatch /></ProtectedRoute>} />
        <Route path="/warehouse/stocktaking" element={<ProtectedRoute claim="warehouse:view"><Stocktaking /></ProtectedRoute>} />
        <Route path="/warehouse/reports" element={<ProtectedRoute claim="warehouse:view"><InventoryReports /></ProtectedRoute>} />
        {/* ─── Module 12: Product Traceability ─── */}
        <Route path="/trace/intake" element={<ProtectedRoute claim="traceability:read"><TraceIntake /></ProtectedRoute>} />
        <Route path="/trace/tanks" element={<ProtectedRoute claim="traceability:read"><TraceTank /></ProtectedRoute>} />
        <Route path="/trace/batches" element={<ProtectedRoute claim="traceability:read"><TraceBatch /></ProtectedRoute>} />
        <Route path="/trace/finished" element={<ProtectedRoute claim="traceability:read"><TraceFinished /></ProtectedRoute>} />
        <Route path="/trace/quality" element={<ProtectedRoute claim="traceability:read"><TraceQuality /></ProtectedRoute>} />
        <Route path="/trace/recall" element={<ProtectedRoute claim="traceability:read"><BatchRecall /></ProtectedRoute>} />
        <Route path="/trace/search" element={<ProtectedRoute claim="traceability:read"><TraceSearch /></ProtectedRoute>} />
      </Route>
    </Routes>
    </Suspense>
    </ThemeProvider>
  );
}
