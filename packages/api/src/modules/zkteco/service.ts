// ZKTeco attendance service — device registry, ADMS line parsing, punch recording.
import { Prisma } from '@prisma/client';
import type { AttendancePunch, PunchStatus, ZKTecoDevice } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export interface ParsedAttLine {
  zkPin: string;
  punchTime: Date;
  status: PunchStatus;
  verifyMode: string;
  workCode: string;
}

const VERIFY_MODE_MAP: Record<string, string> = {
  '1': 'Fingerprint',
  '2': 'Password',
  '3': 'Card',
  '15': 'Face',
};

/** Register or refresh a device from its ADMS serial number. */
export async function upsertDeviceFromAdms(sn: string): Promise<ZKTecoDevice> {
  return prisma.zKTecoDevice.upsert({
    where: { serialNo: sn },
    update: { lastSeen: new Date() },
    create: { serialNo: sn, lastSeen: new Date() },
  });
}

/**
 * Parse one ADMS ATTLOG line: "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode".
 * Returns null when the line is malformed or the timestamp is invalid.
 */
export function parseAdmsAttLine(line: string): ParsedAttLine | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;

  const [pinRaw, timeRaw, statusRaw, verifyRaw, workCodeRaw] = parts;
  const zkPin = pinRaw.trim();
  if (!zkPin) return null;

  const punchTime = new Date(timeRaw.trim().replace(' ', 'T'));
  if (isNaN(punchTime.getTime())) return null;

  const status: PunchStatus = statusRaw.trim() === '1' ? 'CHECK_OUT' : 'CHECK_IN';

  const verifyCode = (verifyRaw ?? '').trim();
  const verifyMode = VERIFY_MODE_MAP[verifyCode] ?? (verifyCode ? `Mode:${verifyCode}` : '');

  return {
    zkPin,
    punchTime,
    status,
    verifyMode,
    workCode: (workCodeRaw ?? '').trim(),
  };
}

export interface RecordPunchInput {
  zkPin: string;
  punchTime: Date;
  status: PunchStatus;
  verifyMode?: string;
  workCode?: string;
  deviceSn?: string;
}

/**
 * Persist one attendance punch. Resolves the employee via zkPin when known.
 * Returns null for duplicate punches (unique on zkPin + punchTime + deviceSn).
 */
export async function recordPunch(input: RecordPunchInput): Promise<AttendancePunch | null> {
  const employee = await prisma.employee.findUnique({ where: { zkPin: input.zkPin } });
  try {
    return await prisma.attendancePunch.create({
      data: {
        zkPin: input.zkPin,
        employeeId: employee?.id ?? null,
        punchTime: input.punchTime,
        status: input.status,
        verifyMode: input.verifyMode || null,
        workCode: input.workCode || null,
        deviceSn: input.deviceSn || null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null; // duplicate punch — safe to ignore
    }
    throw err;
  }
}
