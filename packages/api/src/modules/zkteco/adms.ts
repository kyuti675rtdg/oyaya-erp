// ZKTeco ADMS push endpoint — mounted at /iclock in app.ts (express.text() parser, NO auth).
// Devices POST their attendance logs here; the server answers in the plain-text
// ADMS protocol dialect the devices expect.
import { Router } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { parseAdmsAttLine, recordPunch, upsertDeviceFromAdms } from './service';

export const admsRouter = Router();

const ATTLOG_OPTIONS =
  'GET OPTION FROM:ATTLOG\n' +
  'ATTLOGStamp=0\n' +
  'OPLOGStamp=0\n' +
  'ErrorDelay=30\n' +
  'Delay=10\n' +
  'TransTimes=00:00;14:05\n' +
  'TransInterval=1\n' +
  'TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP Face UserPic\n' +
  'Realtime=1\n' +
  'Encrypt=0';

admsRouter.get('/cdata', async (req, res, next) => {
  try {
    const sn = String(req.query.SN ?? '');
    if (!sn) throw new AppError(400, 'Missing SN');

    await upsertDeviceFromAdms(sn);

    if (req.query.options === 'all') {
      res.type('text/plain').send(ATTLOG_OPTIONS);
    } else {
      res.type('text/plain').send('OK');
    }
  } catch (err) {
    next(err);
  }
});

admsRouter.post('/cdata', async (req, res, next) => {
  try {
    const sn = String(req.query.SN ?? '');
    const table = String(req.query.table ?? '');

    if (table === 'ATTLOG') {
      const body = String(req.body ?? '');
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const parsed = parseAdmsAttLine(line);
          if (parsed) {
            await recordPunch({ ...parsed, deviceSn: sn || undefined });
          }
        } catch {
          // Malformed line or transient DB error — skip and continue with the rest.
          continue;
        }
      }
      if (sn) {
        await upsertDeviceFromAdms(sn);
      }
    }

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

admsRouter.get('/getrequest', async (req, res, next) => {
  try {
    const sn = String(req.query.SN ?? '');
    if (sn) {
      await upsertDeviceFromAdms(sn);
    }
    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});

admsRouter.post('/devicecmd', (_req, res, next) => {
  try {
    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
});
