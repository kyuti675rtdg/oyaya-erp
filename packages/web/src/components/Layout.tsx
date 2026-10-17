import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useTheme } from '../lib/theme';
import { OfflineBanner } from './OfflineBanner';

interface NavItem {
  to: string;
  label: string;
  claim?: string | string[];
  icon: string;
}

interface NavGroup {
  title: string;
  icon: string;
  items: NavItem[];
}

// Inner SVG paths (stroke style, 20x20 viewBox); sized via the svgIcon helper
const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="4" rx="1.5" />
      <rect x="11" y="9" width="6" height="8" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
    </>
  ),
  intake: (
    <>
      <path d="M10 3v10m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v1.5A1.5 1.5 0 005.5 18h9a1.5 1.5 0 001.5-1.5V15" strokeLinecap="round" />
    </>
  ),
  tanks: (
    <>
      <path d="M6 3h8l1 4H5l1-4z" strokeLinejoin="round" />
      <path d="M5 7v9a2 2 0 002 2h6a2 2 0 002-2V7" strokeLinecap="round" />
      <path d="M5 11h10" strokeLinecap="round" />
    </>
  ),
  batches: (
    <>
      <circle cx="7" cy="7" r="3.5" />
      <circle cx="13.5" cy="13" r="3.5" />
      <path d="M10.5 7H14a2 2 0 012 2v1.5" strokeLinecap="round" />
    </>
  ),
  shifts: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  qc: (
    <>
      <path d="M8 3h4M9 3v5l-4.2 8.4A1.5 1.5 0 006.1 18.5h7.8a1.5 1.5 0 001.3-2.1L11 8V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13h5" strokeLinecap="round" />
    </>
  ),
  capa: (
    <>
      <path d="M10 2.5l6.5 3v5c0 4-2.8 6.8-6.5 8-3.7-1.2-6.5-4-6.5-8v-5l6.5-3z" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.8 8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sales: (
    <>
      <path d="M3 6h14l-1.2 9.2a1.5 1.5 0 01-1.5 1.3H5.7a1.5 1.5 0 01-1.5-1.3L3 6z" strokeLinejoin="round" />
      <path d="M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
      <path d="M8 6V5a2 2 0 012-2h0a2 2 0 012 2v1" strokeLinecap="round" />
    </>
  ),
  finance: (
    <>
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M3 10h14M7 15h4" strokeLinecap="round" />
      <path d="M6 6V4.5A1.5 1.5 0 017.5 3h5A1.5 1.5 0 0114 4.5V6" strokeLinecap="round" />
    </>
  ),
  payroll: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16a4.5 4.5 0 019 0" strokeLinecap="round" />
      <path d="M14 4.5A2.5 2.5 0 0116.5 7M14.5 11.5a4.5 4.5 0 013 4.5" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4" strokeLinecap="round" />
    </>
  ),
  modules: (
    <>
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" />
    </>
  ),
  monitor: (
    <>
      <path d="M2.5 12.5l3.5-6 3 4 2.5-3 3 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 17h14" strokeLinecap="round" />
    </>
  ),
  support: (
    <>
      <path d="M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
      <path d="M7.8 7.8A2.5 2.5 0 0110 6.5c1.4 0 2.5 1 2.5 2.2 0 1.7-2.2 2-2.5 3.3" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" />
    </>
  ),
  truck: (
    <>
      <path d="M2 4.5h10V13H2z" strokeLinejoin="round" />
      <path d="M12 7.5h3.2l2.3 3v2.5H12" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="14.8" cy="15" r="1.6" />
    </>
  ),
  package: (
    <>
      <path d="M10 2.8L17 6.5v7L10 17.2L3 13.5v-7L10 2.8z" strokeLinejoin="round" />
      <path d="M3 6.5l7 3.7 7-3.7M10 10.2v7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  factory: (
    <>
      <path d="M4 17V9.5l5-3.5v3.5l5-3.5V17" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 17h15" strokeLinecap="round" />
    </>
  )
};

function svgIcon(name: string, className: string): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const NAV: NavGroup[] = [
  {
    title: 'Procurement',
    icon: 'truck',
    items: [
      { to: '/intake', label: 'Intake', claim: ['intake:create', 'intake:read'], icon: 'intake' },
      { to: '/suppliers', label: 'Suppliers', claim: ['procurement:view'], icon: 'truck' },
      { to: '/purchase-orders', label: 'Purchase Orders', claim: ['procurement:view'], icon: 'finance' },
      { to: '/incoming-inspection', label: 'Inspection', claim: ['procurement:view'], icon: 'qc' },
      { to: '/accounts-payable', label: 'Vendor Payables', claim: ['procurement:view'], icon: 'finance' },
      { to: '/procurement-reports', label: 'Procurement Reports', claim: ['procurement:view'], icon: 'dashboard' }
    ]
  },
  {
    title: 'Storage',
    icon: 'tanks',
    items: [
      { to: '/dry-storage', label: 'Dry Storage', claim: ['tanks:read'], icon: 'package' },
      { to: '/tanks', label: 'Tanks', claim: ['tanks:read'], icon: 'tanks' },
      { to: '/tank-filling', label: 'Filling', claim: ['tanks:read'], icon: 'intake' },
      { to: '/blend-tracking', label: 'Blends', claim: ['tanks:read'], icon: 'batches' },
      { to: '/conditioning-monitor', label: 'Monitor', claim: ['tanks:read'], icon: 'shifts' },
      { to: '/tank-release', label: 'Release', claim: ['tanks:read'], icon: 'qc' },
      { to: '/stock-movement', label: 'Movements', claim: ['tanks:read'], icon: 'dashboard' },
      { to: '/storage-reports', label: 'Storage Reports', claim: ['tanks:read'], icon: 'finance' }
    ]
  },
  {
    title: 'Production',
    icon: 'factory',
    items: [
      { to: '/production-plans', label: 'Production Plans', claim: ['production:view'], icon: 'dashboard' },
      { to: '/batches', label: 'Batches', claim: ['batches:read'], icon: 'batches' },
      { to: '/blend-recipes', label: 'Recipes', claim: ['production:view'], icon: 'batches' },
      { to: '/wheat-washing', label: 'Washing', claim: ['production:view'], icon: 'intake' },
      { to: '/milling-process', label: 'Milling', claim: ['production:view'], icon: 'factory' },
      { to: '/shifts', label: 'Shifts', claim: ['shifts:read'], icon: 'shifts' },
      { to: '/downtime', label: 'Downtime', claim: ['production:view'], icon: 'monitor' },
      { to: '/flour-output', label: 'Output', claim: ['production:view'], icon: 'package' },
      { to: '/yield-alerts', label: 'Yield Alerts', claim: ['production:view'], icon: 'capa' },
      { to: '/production-reports', label: 'Production Reports', claim: ['production:view'], icon: 'finance' }
    ]
  },
  {
    title: 'Quality',
    icon: 'qc',
    items: [
      { to: '/qc', label: 'Lab Checks', claim: ['qc:read'], icon: 'qc' },
      { to: '/quality/standards', label: 'Standards', claim: ['qc:view'], icon: 'settings' },
      { to: '/quality/flour-tests', label: 'Flour Tests', claim: ['qc:view'], icon: 'qc' },
      { to: '/quality/sampling', label: 'Sampling', claim: ['qc:view'], icon: 'shifts' },
      { to: '/quality/approval', label: 'Approval', claim: ['qc:view'], icon: 'intake' },
      { to: '/quality/reports', label: 'Quality Reports', claim: ['qc:view'], icon: 'finance' }
    ]
  },
  {
    title: 'CAPA',
    icon: 'capa',
    items: [
      { to: '/capa', label: 'CAPA', claim: ['capa:read'], icon: 'capa' },
      { to: '/nc-register', label: 'NC Register', claim: ['capa:view'], icon: 'capa' },
      { to: '/nc-root-cause', label: 'Root Cause', claim: ['capa:view'], icon: 'dashboard' },
      { to: '/nc-actions', label: 'NC Actions', claim: ['capa:view'], icon: 'shifts' },
      { to: '/nc-disposition', label: 'Disposition', claim: ['capa:view'], icon: 'package' },
      { to: '/nc-signoff', label: 'Sign-Off', claim: ['capa:view'], icon: 'intake' },
      { to: '/nc-reports', label: 'NC Reports', claim: ['capa:view'], icon: 'finance' }
    ]
  },
  {
    title: 'Finished Goods',
    icon: 'package',
    items: [
      { to: '/fg', label: 'FG Stock', claim: ['fg:view'], icon: 'package' },
      { to: '/fg/grades', label: 'Grades', claim: ['fg:view'], icon: 'qc' },
      { to: '/fg/packaging', label: 'Packaging', claim: ['fg:view'], icon: 'batches' },
      { to: '/fg/labels', label: 'Labels', claim: ['fg:view'], icon: 'intake' },
      { to: '/fg/byproducts', label: 'Byproducts', claim: ['fg:view'], icon: 'dashboard' },
      { to: '/fg/aging', label: 'Aging', claim: ['fg:view'], icon: 'shifts' },
      { to: '/fg/reports', label: 'FG Reports', claim: ['fg:view'], icon: 'finance' }
    ]
  },
  {
    title: 'Warehouse',
    icon: 'dashboard',
    items: [
      { to: '/warehouse/locations', label: 'Locations', claim: ['warehouse:view'], icon: 'package' },
      { to: '/warehouse/putaway', label: 'Put-Away', claim: ['warehouse:view'], icon: 'intake' },
      { to: '/warehouse/transfers', label: 'Transfers', claim: ['warehouse:view'], icon: 'truck' },
      { to: '/warehouse/adjustments', label: 'Adjustments', claim: ['warehouse:view'], icon: 'settings' },
      { to: '/warehouse/reservations', label: 'Reservations', claim: ['warehouse:view'], icon: 'shifts' },
      { to: '/warehouse/dispatch', label: 'Dispatch', claim: ['warehouse:view'], icon: 'sales' },
      { to: '/warehouse/stocktaking', label: 'Stocktaking', claim: ['warehouse:view'], icon: 'qc' },
      { to: '/warehouse/reports', label: 'WH Reports', claim: ['warehouse:view'], icon: 'finance' }
    ]
  },
  {
    title: 'Sales',
    icon: 'sales',
    items: [
      { to: '/sales', label: 'Sales Orders', claim: ['sales:read'], icon: 'sales' },
      { to: '/sales/agreements', label: 'Agreements', claim: ['sales:read'], icon: 'finance' },
      { to: '/sales/advances', label: 'Advances', claim: ['sales:read'], icon: 'finance' },
      { to: '/sales/loading', label: 'Loading', claim: ['sales:read'], icon: 'package' },
      { to: '/sales/consolidation', label: 'Consolidation', claim: ['sales:read'], icon: 'truck' },
      { to: '/sales/trips', label: 'Delivery Trips', claim: ['sales:read'], icon: 'truck' },
      { to: '/sales/agents', label: 'Agents', claim: ['sales:read'], icon: 'shifts' },
      { to: '/sales/invoices', label: 'Invoices', claim: ['sales:read'], icon: 'finance' },
      { to: '/sales/cash', label: 'Cash', claim: ['sales:read'], icon: 'finance' },
      { to: '/sales/reports', label: 'Sales Reports', claim: ['sales:read'], icon: 'monitor' }
    ]
  },
  {
    title: 'Finance',
    icon: 'finance',
    items: [
      { to: '/finance', label: 'Overview', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/chart-of-accounts', label: 'Accounts', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/ledger', label: 'Ledger', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/accounts-payable', label: 'AP Payables', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/accounts-receivable', label: 'Receivables', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/cash-bank', label: 'Cash & Bank', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/vouchers', label: 'Vouchers', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/expenses', label: 'Expenses', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/payroll-journal', label: 'Payroll Journal', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/trial-balance', label: 'Trial Balance', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/income-statement', label: 'Income Stmt', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/balance-sheet', label: 'Balance Sheet', claim: ['finance:read'], icon: 'finance' },
      { to: '/finance/reports', label: 'Fin Reports', claim: ['finance:read'], icon: 'finance' },
      { to: '/payroll', label: 'Payroll', claim: ['payroll:read'], icon: 'payroll' }
    ]
  },
  {
    title: 'Fleet',
    icon: 'truck',
    items: [
      { to: '/fleet/vehicles', label: 'Vehicles', claim: ['fleet:view'], icon: 'truck' },
      { to: '/fleet/contracts', label: 'Contracts', claim: ['fleet:view'], icon: 'finance' },
      { to: '/fleet/drivers', label: 'Drivers', claim: ['fleet:view'], icon: 'payroll' },
      { to: '/fleet/trips', label: 'Fleet Trips', claim: ['fleet:view'], icon: 'monitor' },
      { to: '/fleet/utilization', label: 'Utilization', claim: ['fleet:view'], icon: 'dashboard' },
      { to: '/fleet/fuel', label: 'Fuel', claim: ['fleet:view'], icon: 'intake' },
      { to: '/fleet/maintenance', label: 'Maintenance', claim: ['fleet:view'], icon: 'factory' },
      { to: '/fleet/reports', label: 'Fleet Reports', claim: ['fleet:view'], icon: 'sales' }
    ]
  },
  {
    title: 'Maintenance',
    icon: 'factory',
    items: [
      { to: '/maintenance/planning', label: 'Maintenance Plans', claim: ['maintenance:view'], icon: 'factory' },
      { to: '/maintenance/pm-checklists', label: 'PM Checklists', claim: ['maintenance:view'], icon: 'shifts' },
      { to: '/maintenance/breakdowns', label: 'Breakdowns', claim: ['maintenance:view'], icon: 'capa' },
      { to: '/maintenance/spare-parts', label: 'Spare Parts', claim: ['maintenance:view'], icon: 'package' },
      { to: '/maintenance/work-orders', label: 'Work Orders', claim: ['maintenance:view'], icon: 'intake' },
      { to: '/maintenance/repair-approval', label: 'Repairs', claim: ['maintenance:view'], icon: 'finance' },
      { to: '/maintenance/reports', label: 'Maint Reports', claim: ['maintenance:view'], icon: 'dashboard' }
    ]
  },
  {
    title: 'Sanitation',
    icon: 'shifts',
    items: [
      { to: '/hygiene/checklists', label: 'Hygiene Lists', claim: ['hygiene:view'], icon: 'shifts' },
      { to: '/hygiene/area-cleaning', label: 'Cleaning', claim: ['hygiene:view'], icon: 'intake' },
      { to: '/hygiene/inspections', label: 'Inspections', claim: ['hygiene:view'], icon: 'qc' },
      { to: '/hygiene/actions', label: 'Actions', claim: ['hygiene:view'], icon: 'capa' },
      { to: '/hygiene/approvals', label: 'Hygiene Approvals', claim: ['hygiene:view'], icon: 'finance' },
      { to: '/hygiene/reports', label: 'Hygiene Reports', claim: ['hygiene:view'], icon: 'dashboard' }
    ]
  },
  {
    title: 'Pest Control',
    icon: 'monitor',
    items: [
      { to: '/pest/schedule', label: 'Schedule', claim: ['pest:view'], icon: 'shifts' },
      { to: '/pest/risk-inspections', label: 'Risk Areas', claim: ['pest:view'], icon: 'qc' },
      { to: '/pest/treatments', label: 'Treatments', claim: ['pest:view'], icon: 'intake' },
      { to: '/pest/follow-ups', label: 'Follow-Ups', claim: ['pest:view'], icon: 'capa' },
      { to: '/pest/alerts', label: 'Alerts', claim: ['pest:view'], icon: 'monitor' },
      { to: '/pest/reports', label: 'Pest Reports', claim: ['pest:view'], icon: 'finance' }
    ]
  },
  {
    title: 'HR',
    icon: 'payroll',
    items: [
      { to: '/hr/employees', label: 'Employees', claim: ['hr:read'], icon: 'payroll' },
      { to: '/hr/departments', label: 'Departments', claim: ['hr:read'], icon: 'settings' },
      { to: '/hr/attendance', label: 'Attendance', claim: ['hr:read'], icon: 'shifts' },
      { to: '/hr/fixed-payroll', label: 'Salaries', claim: ['hr:read'], icon: 'finance' },
      { to: '/hr/piece-rate', label: 'Piece-Rate', claim: ['hr:read'], icon: 'dashboard' },
      { to: '/hr/driver-payroll', label: 'Driver Pay', claim: ['hr:read'], icon: 'truck' },
      { to: '/hr/allowances', label: 'Allowances', claim: ['hr:read'], icon: 'sales' },
      { to: '/hr/payroll-run', label: 'Payroll Run', claim: ['hr:read'], icon: 'monitor' },
      { to: '/hr/payslips', label: 'Payslips', claim: ['hr:read'], icon: 'qc' }
    ]
  },
  {
    title: 'Traceability',
    icon: 'intake',
    items: [
      { to: '/trace/intake', label: 'Intake Trace', claim: ['traceability:read'], icon: 'intake' },
      { to: '/trace/tanks', label: 'Tank Trace', claim: ['traceability:read'], icon: 'tanks' },
      { to: '/trace/batches', label: 'Batch Trace', claim: ['traceability:read'], icon: 'batches' },
      { to: '/trace/finished', label: 'Product Trace', claim: ['traceability:read'], icon: 'package' },
      { to: '/trace/quality', label: 'Quality Trace', claim: ['traceability:read'], icon: 'qc' },
      { to: '/trace/recall', label: 'Recalls', claim: ['traceability:read'], icon: 'capa' },
      { to: '/trace/search', label: 'Trace Search', claim: ['traceability:read'], icon: 'dashboard' }
    ]
  },
  {
    title: 'BI',
    icon: 'monitor',
    items: [
      { to: '/bi/production', label: 'Production', claim: ['production:view'], icon: 'factory' },
      { to: '/bi/quality', label: 'Quality', claim: ['qc:view'], icon: 'qc' },
      { to: '/bi/procurement', label: 'Procurement', claim: ['procurement:view'], icon: 'truck' },
      { to: '/bi/inventory', label: 'Inventory', claim: ['storage:view'], icon: 'package' },
      { to: '/bi/sales', label: 'Sales', claim: ['sales:view'], icon: 'sales' },
      { to: '/bi/finance', label: 'Finance', claim: ['finance:view'], icon: 'finance' },
      { to: '/bi/hr', label: 'HR', claim: ['payroll:view'], icon: 'payroll' },
      {
        to: '/bi/report-builder',
        label: 'Builder',
        claim: ['production:view', 'qc:view', 'procurement:view', 'storage:view', 'sales:view', 'finance:view', 'payroll:view'],
        icon: 'dashboard'
      }
    ]
  },
  {
    title: 'Admin',
    icon: 'settings',
    items: [
      { to: '/settings', label: 'Settings', claim: ['settings:read'], icon: 'settings' },
      { to: '/admin/users', label: 'Users', claim: ['settings:read'], icon: 'payroll' },
      { to: '/admin/roles', label: 'Roles', claim: ['settings:read'], icon: 'capa' },
      { to: '/admin/security', label: 'Security', claim: ['settings:read'], icon: 'settings' },
      { to: '/admin/api-health', label: 'API Health', claim: ['settings:read'], icon: 'monitor' },
      { to: '/admin/webhooks', label: 'Webhooks', claim: ['settings:read'], icon: 'modules' },
      { to: '/admin/notifications', label: 'Notifications', claim: ['settings:read'], icon: 'support' },
      { to: '/admin/audit-logs', label: 'Audit Logs', claim: ['settings:read'], icon: 'intake' },
      { to: '/admin/backup', label: 'Backup', claim: ['settings:read'], icon: 'package' }
    ]
  },
  {
    title: 'Support',
    icon: 'support',
    items: [
      { to: '/support', label: 'Support', claim: ['support:read'], icon: 'support' },
      { to: '/support/manuals', label: 'Manuals', claim: ['support:read'], icon: 'support' },
      { to: '/support/sops', label: 'SOPs', claim: ['support:read'], icon: 'support' },
      { to: '/support/knowledge-base', label: 'Knowledge', claim: ['support:read'], icon: 'support' },
      { to: '/support/tickets', label: 'Tickets', claim: ['support:read'], icon: 'support' },
      { to: '/support/tech-support', label: 'Tech Support', claim: ['support:read'], icon: 'support' },
      { to: '/support/announcements', label: 'Announcements', claim: ['support:read'], icon: 'support' },
      { to: '/support/notifications', label: 'SMS & Alerts', claim: ['support:read'], icon: 'support' }
    ]
  },
  {
    title: 'Documents',
    icon: 'intake',
    items: [
      { to: '/documents', label: 'Library', claim: ['documents:view'], icon: 'intake' },
      { to: '/documents/folders', label: 'Folders', claim: ['documents:view'], icon: 'package' },
      { to: '/documents/versions', label: 'Versions', claim: ['documents:view'], icon: 'shifts' },
      { to: '/documents/approvals', label: 'Doc Approvals', claim: ['documents:view'], icon: 'finance' },
      { to: '/documents/templates', label: 'Templates', claim: ['documents:view'], icon: 'dashboard' },
      { to: '/documents/archive', label: 'Archive', claim: ['documents:view'], icon: 'capa' },
      { to: '/documents/sharing', label: 'Sharing', claim: ['documents:view'], icon: 'sales' }
    ]
  }
];

/** Standalone bottom items (no chevron) per reference design. */
const BOTTOM_NAV: NavItem[] = [
  { to: '/api-monitor', label: 'API Monitor', claim: ['settings:read'], icon: 'monitor' },
  { to: '/module-manager', label: 'Modules', claim: ['settings:read'], icon: 'modules' }
];

function itemMatches(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function Logo() {
  return (
    <div className="px-3 pb-2 pt-3">
      <button
        type="button"
        className="touch flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50"
        aria-label="Workspace: Oyaya ERP"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21V7" />
            <path d="M12 10C9 10 6.5 7.5 6.5 4.5 9.5 4.5 12 7 12 10z" />
            <path d="M12 10c3 0 5.5-2.5 5.5-5.5C14.5 4.5 12 7 12 10z" />
            <path d="M12 15c-2.5 0-4.5-2-4.5-4.5 2.5 0 4.5 2 4.5 4.5z" />
            <path d="M12 15c2.5 0 4.5-2 4.5-4.5-2.5 0-4.5 2-4.5 4.5z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-gray-900 dark:text-white">Oyaya ERP</span>
          <span className="block truncate text-xs leading-tight text-gray-500 dark:text-slate-400">Flour Mill</span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden="true">
          <path d="M7 6.5l3-3 3 3M7 13.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

/** Accessible ERP sidebar: search, favorites, recents, full keyboard support. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, hasAnyClaim } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSidebarLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleHelp = hasAnyClaim(['support:read']);
  const visibleSettings = hasAnyClaim(['settings:read']);
  const profileInitial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase();
  const profileName = user?.name ?? user?.email ?? 'User';
  const profileRole = user?.role ?? '';

  const visible = (item: NavItem) =>
    !item.claim || hasAnyClaim(Array.isArray(item.claim) ? item.claim : [item.claim]);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(visible)
  })).filter((group) => group.items.length > 0);

  const visibleBottom = BOTTOM_NAV.filter(visible);

  // Favorites (persisted)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('oyaya-fav-modules') ?? '[]');
    } catch {
      return [];
    }
  });
  const toggleFavorite = (title: string) => {
    setFavorites((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try {
        localStorage.setItem('oyaya-fav-modules', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };

  // Recents (last 4 visited)
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('oyaya-recent-modules') ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const match = visibleGroups.find((g) => g.items.some((i) => itemMatches(i, pathname)));
    if (match) {
      setRecents((prev) => {
        const next = [match.title, ...prev.filter((t) => t !== match.title)].slice(0, 4);
        try {
          localStorage.setItem('oyaya-recent-modules', JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Search
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filteredGroups = q
    ? visibleGroups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) => g.title.toLowerCase().includes(q) || i.label.toLowerCase().includes(q)
          )
        }))
        .filter((g) => g.items.length > 0 || g.title.toLowerCase().includes(q))
    : visibleGroups;

  // '/' focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    const active = visibleGroups.find((g) => g.items.some((i) => itemMatches(i, pathname)));
    return active ? active.title : null;
  });
  useEffect(() => {
    if (q && filteredGroups.length > 0) setOpenGroup(filteredGroups[0].title);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionLabel = 'mb-1 mt-4 px-3 text-xs font-medium text-gray-500 dark:text-slate-500';
  const itemBase =
    'touch relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500';
  const itemIdle = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700/60';
  const itemActive =
    'bg-violet-50 font-semibold text-violet-900 dark:bg-violet-500/15 dark:text-violet-200';

  const renderGroup = (group: (typeof visibleGroups)[number], showFav = true) => {
    const isOpen = openGroup === group.title || !!q;
    const hasActive = group.items.some((i) => itemMatches(i, pathname));
    const isFav = favorites.includes(group.title);
    return (
      <div key={group.title} className="mb-px">
        <div className={`group flex items-center rounded-md ${isOpen || hasActive ? 'bg-gray-100 dark:bg-slate-700/60' : ''}`}>
          <button
            type="button"
            onClick={() => setOpenGroup(isOpen && !q ? null : group.title)}
            aria-expanded={isOpen}
            aria-controls={`nav-group-${group.title}`}
            className={`${itemBase} flex-1 ${isOpen || hasActive ? 'font-medium text-gray-900 dark:text-white' : itemIdle}`}
          >
            {hasActive ? (
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" aria-hidden="true" />
            ) : null}
            <span className="min-w-0 flex-1 truncate pl-1">{group.title}</span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}
              className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 dark:text-slate-500 ${isOpen ? 'rotate-90' : ''}`}
              aria-hidden="true">
              <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showFav ? (
            <button
              type="button"
              onClick={() => toggleFavorite(group.title)}
              aria-pressed={isFav}
              aria-label={isFav ? `Remove ${group.title} from favorites` : `Add ${group.title} to favorites`}
              className="mr-1 hidden shrink-0 rounded p-1.5 text-gray-300 transition-colors hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 group-hover:block dark:text-slate-600 dark:hover:text-amber-400"
            >
              <svg viewBox="0 0 20 20" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6}
                className={`h-4 w-4 ${isFav ? 'text-amber-500' : ''}`} aria-hidden="true">
                <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2L2.5 8.1l5.2-.7z" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
        {isOpen ? (
          <ul id={`nav-group-${group.title}`} className="mb-0.5 mt-px space-y-px" aria-label={`${group.title} submodules`}>
            {group.items.map((item) => {
              const active = itemMatches(item, pathname);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to} end={item.to === '/'} onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`${itemBase} pl-7 text-[13px] ${active ? itemActive : 'text-gray-600 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700/60'}`}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" aria-hidden="true" />
                    ) : null}
                    <span className="truncate pl-1">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  };

  const favGroups = visibleGroups.filter((g) => favorites.includes(g.title));
  const acctActive = (to: string) => itemMatches({ to } as NavItem, pathname);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-2 pb-1 pt-2" role="search">
        <label htmlFor="sidebar-module-search" className="sr-only">Search modules and submodules</label>
        <div className="relative">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.5 13.5L17 17" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef} id="sidebar-module-search" type="search" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); } }}
            placeholder="Search modules\u2026" autoComplete="off"
            className="w-full rounded-md border border-gray-200 bg-gray-50 py-2 pl-9 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:text-slate-300">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-500" aria-hidden="true">/</kbd>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1" aria-label="Primary">
        {q ? (
          <>
            <p className={sectionLabel} role="status" aria-live="polite">
              {filteredGroups.length === 0 ? `No modules match "${query}"` : `${filteredGroups.length} found`}
            </p>
            {filteredGroups.map((g) => renderGroup(g, false))}
          </>
        ) : (
          <>
            <NavLink to="/" end onClick={onNavigate}
              aria-current={pathname === '/' ? 'page' : undefined}
              className={`${itemBase} mb-0.5 ${pathname === '/' ? itemActive : itemIdle}`}>
              {pathname === '/' ? (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" aria-hidden="true" />
              ) : null}
              <span className="truncate pl-1">Dashboard</span>
            </NavLink>

            {favGroups.length > 0 ? (
              <><p className={sectionLabel}>Favorites</p>{favGroups.map((g) => renderGroup(g))}</>
            ) : null}

            {recents.length > 0 ? (
              <>
                <p className={sectionLabel}>Recent</p>
                <ul className="mb-1 space-y-px" aria-label="Recently visited modules">
                  {recents.map((t) => {
                    const group = visibleGroups.find((g) => g.title === t);
                    if (!group) return null;
                    const hasActive = group.items.some((i) => itemMatches(i, pathname));
                    return (
                      <li key={group.title}>
                        <NavLink to={group.items[0].to} onClick={onNavigate}
                          className={`${itemBase} ${hasActive ? itemActive : itemIdle}`}>
                          {hasActive ? (
                            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" aria-hidden="true" />
                          ) : null}
                          <span className="truncate pl-1">{group.title}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}

            <p className={sectionLabel}>All modules</p>
            {visibleGroups.map((g) => renderGroup(g))}

            <p className={sectionLabel}>Account</p>
            {[
              { to: '/admin/notifications', label: 'Notification' },
              { to: '/support/tickets', label: 'Chat' },
              ...(visibleSettings ? [{ to: '/settings', label: 'Settings' }] : []),
              ...(visibleHelp ? [{ to: '/support', label: 'Support' }] : []),
            ].map((a) => (
              <NavLink key={a.to} to={a.to} onClick={onNavigate}
                aria-current={acctActive(a.to) ? 'page' : undefined}
                className={`${itemBase} mb-px ${acctActive(a.to) ? itemActive : itemIdle}`}>
                {acctActive(a.to) ? (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" aria-hidden="true" />
                ) : null}
                <span className="truncate pl-1">{a.label}</span>
              </NavLink>
            ))}

            {visibleBottom.length > 0 ? (
              <div className="mt-3 border-t border-gray-200 pt-2 dark:border-slate-700">
                {visibleBottom.map((item) => {
                  const active = itemMatches(item, pathname);
                  return (
                    <NavLink key={item.to} to={item.to} onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`${itemBase} mb-px text-[13px] ${active ? itemActive : 'text-gray-600 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700/60'}`}>
                      <span className="truncate pl-1">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </nav>

      <div className="border-t border-gray-200 p-2 dark:border-slate-700">
        <button type="button" onClick={() => { handleSidebarLogout(); onNavigate?.(); }}
          className={`${itemBase} ${itemIdle} mb-1`} aria-label="Log out">
          <span className="truncate pl-1">Logout</span>
        </button>
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" aria-label={`Signed in as ${profileName}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white" aria-hidden="true">
            {profileInitial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-gray-900 dark:text-white">{profileName}</p>
            <p className="truncate text-xs leading-tight text-gray-500 dark:text-slate-400">{profileRole || user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const now = useNow();

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex min-h-screen bg-[#F5F6FA] text-gray-900 dark:bg-slate-900 dark:text-slate-100">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 md:flex">
        <Logo />
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between pr-4">
              <Logo />
              <button
                onClick={() => setMenuOpen(false)}
                className="touch rounded-lg px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 md:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="touch rounded-lg p-2.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-slate-700 md:hidden"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
            </svg>
          </button>

          {/* Search — centered pill like reference */}
          <div className="flex flex-1 justify-center">
            <div className="relative hidden w-full max-w-md sm:block">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" />
                <path d="M13.5 13.5L17 17" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search anything"
                className="w-full rounded-full border border-transparent bg-gray-100 py-2.5 pl-11 pr-4 text-sm text-gray-900 outline-none transition-shadow placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                aria-label="Search"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="touch rounded-lg p-2.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-amber-400"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                  <circle cx="10" cy="10" r="4" />
                  <path d="M10 2v2M10 16v2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M2 10h2M16 10h2M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                  <path d="M16.5 13.5A7 7 0 016.5 3.5a7 7 0 1010 10z" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {/* Notification bell + popover */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="touch relative rounded-lg p-2.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Notifications"
                aria-expanded={notifOpen}
                aria-haspopup="true"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                  <path d="M10 3a4.5 4.5 0 00-4.5 4.5c0 3-1 4-1.5 4.5h12C15.5 11.5 14.5 10.5 14.5 7.5A4.5 4.5 0 0010 3z" strokeLinejoin="round" />
                  <path d="M8 15a2 2 0 004 0" strokeLinecap="round" />
                </svg>
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-800">
                  3
                </span>
              </button>
              {notifOpen ? (
                <>
                  <button
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setNotifOpen(false)}
                    aria-label="Close notifications"
                    tabIndex={-1}
                  />
                  <div
                    className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
                    role="menu"
                    aria-label="Notifications"
                  >
                    <p className="px-3 pb-1 pt-2 text-sm font-bold text-gray-800 dark:text-slate-100">Notifications</p>
                    {[
                      { dot: 'bg-amber-500', title: 'QC sample flagged', sub: 'Moisture above threshold — review required' },
                      { dot: 'bg-rose-500', title: 'CAPA overdue', sub: 'Corrective action past due date' },
                      { dot: 'bg-violet-500', title: 'Duket yield alert', sub: 'Yield below 78% on latest shift' }
                    ].map((n) => (
                      <div key={n.title} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.dot}`} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-gray-800 dark:text-slate-100">{n.title}</p>
                          <p className="truncate text-xs text-gray-500 dark:text-slate-400">{n.sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {/* App grid */}
            <button
              className="touch rounded-lg p-2.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-slate-700"
              aria-label="All modules"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                <rect x="3" y="3" width="5.5" height="5.5" rx="1.5" />
                <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" />
                <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" />
                <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" />
              </svg>
            </button>

            <div className="hidden h-8 w-px bg-gray-200 dark:bg-slate-700 sm:block" aria-hidden="true" />

            {/* Date / time */}
            <div className="hidden items-center gap-2 lg:flex" aria-label="Current date and time">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-slate-400 dark:text-slate-500" aria-hidden="true">
                <rect x="3" y="4.5" width="14" height="12" rx="2" />
                <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
              </svg>
              <div className="text-left">
                <p className="text-sm font-semibold leading-tight text-gray-900 dark:text-white">{dateStr}</p>
                <p className="tnum text-xs leading-tight text-gray-400 dark:text-slate-500">{timeStr}</p>
              </div>
            </div>

            {/* Avatar + account menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="touch flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-slate-700"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
                  {initial}
                </div>
                <div className="hidden text-left md:block">
                  <p className="max-w-32 truncate text-sm font-semibold leading-tight text-gray-900 dark:text-white">
                    {user?.name ?? user?.email}
                  </p>
                  <p className="max-w-32 truncate text-xs leading-tight text-gray-400 dark:text-slate-500">{user?.role}</p>
                </div>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`hidden h-4 w-4 text-slate-400 transition-transform duration-200 dark:text-slate-500 md:block ${userMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {userMenuOpen ? (
                <>
                  <button
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setUserMenuOpen(false)}
                    aria-label="Close account menu"
                    tabIndex={-1}
                  />
                  <div
                    className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
                    role="menu"
                    aria-label="Account"
                  >
                    <button
                      onClick={handleLogout}
                      role="menuitem"
                      className="touch flex w-full items-center px-4 py-2 text-left text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:text-slate-100 dark:hover:bg-slate-700/50"
                      aria-label="Log out"
                    >
                      Log out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
