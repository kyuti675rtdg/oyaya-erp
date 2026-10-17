import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';

import { router as authRouter } from './modules/auth/router';
import { router as masterRouter } from './modules/master-data/router';
import { router as procurementRouter } from './modules/procurement/router';
import { router as storageRouter } from './modules/storage/router';
import { router as productionRouter } from './modules/production/router';
import { router as qcRouter } from './modules/qc/router';
import { router as capaRouter } from './modules/capa/router';
import { router as hygieneRouter } from './modules/hygiene/router';
import { router as maintenanceRouter } from './modules/maintenance/router';
import { router as fgRouter } from './modules/fg-warehouse/router';
import { router as traceabilityRouter } from './modules/traceability/router';
import { router as salesRouter } from './modules/sales/router';
import { router as financeRouter } from './modules/finance/router';
import { router as payrollRouter } from './modules/payroll/router';
import { router as fleetRouter } from './modules/fleet/router';
import { router as dashboardRouter } from './modules/dashboard/router';
import { router as syncRouter } from './modules/sync/router';
import { router as smsRouter, webhookRouter as afromessageWebhookRouter } from './modules/sms/router';
import { router as attendanceRouter } from './modules/zkteco/router';
import { router as moduleManagerRouter } from './modules/module-manager/router';
import { router as apiMonitorRouter } from './modules/api-monitor/router';
import { router as supportRouter } from './modules/support/router';
import { router as auditLogRouter } from './modules/audit-log/router';
import { router as pestRouter } from './modules/pest/router';
import { router as warehouseRouter } from './modules/warehouse/router';
import { admsRouter } from './modules/zkteco/adms';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));

// ZKTeco ADMS device protocol: plain-text, unauthenticated, OUTSIDE /api/v1.
app.use('/iclock', express.text({ type: '*/*', limit: '2mb' }), admsRouter);

app.use(express.json({ limit: '2mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, service: 'oyaya-erp-api', time: new Date().toISOString() });
});

const v1 = express.Router();

// Public routes
v1.use('/auth', authRouter);
v1.use('/webhooks', afromessageWebhookRouter);

// Everything below requires a valid JWT
v1.use(authenticate);

v1.use('/master', masterRouter);
v1.use('/procurement', procurementRouter);
v1.use('/storage', storageRouter);
v1.use('/production', productionRouter);
v1.use('/qc', qcRouter);
v1.use('/capa', capaRouter);
v1.use('/hygiene', hygieneRouter);
v1.use('/maintenance', maintenanceRouter);
v1.use('/fg', fgRouter);
v1.use('/traceability', traceabilityRouter);
v1.use('/sales', salesRouter);
v1.use('/finance', financeRouter);
v1.use('/payroll', payrollRouter);
v1.use('/fleet', fleetRouter);
v1.use('/dashboard', dashboardRouter);
v1.use('/sync', syncRouter);
v1.use('/sms', smsRouter);
v1.use('/attendance', attendanceRouter);
v1.use('/module-manager', moduleManagerRouter);
v1.use('/api-monitor', apiMonitorRouter);
v1.use('/support', supportRouter);
v1.use('/audit-log', auditLogRouter);
v1.use('/pest', pestRouter);
v1.use('/warehouse', warehouseRouter);

app.use('/api/v1', v1);

app.use(notFound);
app.use(errorHandler);

export default app;
