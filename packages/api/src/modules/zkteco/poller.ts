// ZKTeco TCP poller — pulls attendance logs over port 4370 from devices
// that have a configured ipAddress. Scheduled every config.zkPollIntervalMin.
import type { PunchStatus } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { recordPunch } from './service';

export async function pollDevices(): Promise<void> {
  const devices = await prisma.zKTecoDevice.findMany({
    where: { isActive: true, ipAddress: { not: null } },
  });

  for (const device of devices) {
    try {
      const { default: ZKLib } = await import('zklib');
      const zk = new ZKLib(device.ipAddress as string, 4370, config.zkDeviceTimeoutMs, 4000);
      await zk.createSocket();
      const logs = await zk.getAttendances();
      try {
        await zk.disconnect();
      } catch {
        /* ignore disconnect errors */
      }

      let n = 0;
      for (const r of logs) {
        const pin = String(r.user_id ?? r.id ?? r.uid ?? '');
        const tsRaw = String(r.timestamp ?? r.time ?? '');
        if (!pin || !tsRaw) continue;

        const t = new Date(tsRaw.replace(' ', 'T'));
        if (isNaN(t.getTime())) continue;

        const st = Number(r.status ?? r.punch ?? r.inout ?? 0);
        const status: PunchStatus = st === 1 ? 'CHECK_OUT' : 'CHECK_IN';

        const p = await recordPunch({
          zkPin: pin,
          punchTime: t,
          status,
          deviceSn: device.serialNo,
        });
        if (p) n++;
      }

      await prisma.zKTecoDevice.update({
        where: { id: device.id },
        data: { lastSeen: new Date() },
      });
      console.log(`[zkteco] polled ${device.serialNo}: ${n} new punches`);
    } catch (err) {
      console.error(`[zkteco] poll failed for ${device.serialNo}:`, (err as Error).message);
      continue;
    }
  }
}
