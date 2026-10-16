// Canonical permission catalog. Codes are stored as "module:action:scope"
// (scope defaults to "all"). requirePermission('module:action') matches any scope.

export const MODULES = [
  'master',
  'procurement',
  'storage',
  'production',
  'qc',
  'capa',
  'hygiene',
  'pest',
  'maintenance',
  'fg',
  'warehouse',
  'traceability',
  'sales',
  'finance',
  'payroll',
  'fleet',
  'dashboard',
  'sync',
  'sms',
  'attendance',
] as const;

export type ModuleName = (typeof MODULES)[number];

export const ACTIONS = ['view', 'manage', 'approve'] as const;

export type ActionName = (typeof ACTIONS)[number];

/** e.g. "procurement:manage" */
export type PermissionCode = `${ModuleName}:${ActionName}`;

export const ALL_PERMISSION_CODES: PermissionCode[] = MODULES.flatMap((m) =>
  ACTIONS.map((a) => `${m}:${a}` as PermissionCode),
);
