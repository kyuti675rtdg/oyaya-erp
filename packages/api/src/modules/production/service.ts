import { Prisma } from '@prisma/client';
import { audit, type DbClient } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { emitEvent } from '../../lib/socket';
import { getPhonesForRoles, queueBulkSms } from '../sms/service';

export interface ShiftOutputInput {
  productId: string;
  quintals: Prisma.Decimal | number;
}

export interface RecordShiftOutputsResult {
  extractionPct: Prisma.Decimal;
  belowYieldFlag: boolean;
}

const LOW_YIELD_THRESHOLD = 78;

/**
 * Persist shift outputs, compute the shift extraction percentage
 * (flour-kind quintals / total quintals * 100), stamp every output row,
 * and raise a low-yield alert when extraction drops below 78%.
 */
export async function recordShiftOutputs(
  tx: DbClient,
  shiftRunId: string,
  outputs: ShiftOutputInput[],
  userId: string,
): Promise<RecordShiftOutputsResult> {
  const shiftRun = await tx.shiftRun.findUnique({
    where: { id: shiftRunId },
    include: { batch: true },
  });
  if (!shiftRun) throw new AppError(404, 'Shift run not found');

  for (const o of outputs) {
    await tx.shiftOutput.create({
      data: {
        shiftRunId,
        productId: o.productId,
        quintals: o.quintals instanceof Prisma.Decimal ? o.quintals : new Prisma.Decimal(o.quintals),
        loggedById: userId,
      },
    });
  }

  const rows = await tx.shiftOutput.findMany({
    where: { shiftRunId },
    include: { product: true },
  });

  let duketQ = new Prisma.Decimal(0);
  let totalQ = new Prisma.Decimal(0);
  for (const row of rows) {
    totalQ = totalQ.plus(row.quintals);
    if (row.product.kind === 'flour') duketQ = duketQ.plus(row.quintals);
  }
  if (totalQ.isZero()) throw new AppError(400, 'Shift has no recorded output quantities');

  const extractionPct = duketQ.div(totalQ).times(100);
  const belowYieldFlag = extractionPct.lt(LOW_YIELD_THRESHOLD);

  await tx.shiftOutput.updateMany({
    where: { shiftRunId },
    data: { extractionPct, belowYieldFlag },
  });

  if (belowYieldFlag) {
    const phones = await getPhonesForRoles(['Production Manager', 'Owner / CEO']);
    await queueBulkSms({
      to: phones,
      message: `[OYAYA ERP] LOW YIELD: batch ${shiftRun.batch.batchNo} ${shiftRun.shift} shift extraction ${extractionPct.toFixed(2)}% below 78%.`,
      trigger: 'LOW_YIELD',
    });
    emitEvent('yield-flag', {
      shiftRunId,
      batchNo: shiftRun.batch.batchNo,
      extractionPct: extractionPct.toNumber(),
    });
  }

  await audit(tx, {
    userId,
    action: 'CREATE',
    entityType: 'ShiftOutput',
    entityId: shiftRunId,
    changes: {
      outputs: outputs.map((o) => ({ productId: o.productId, quintals: o.quintals.toString() })),
      extractionPct: extractionPct.toFixed(2),
      belowYieldFlag,
    },
  });

  return { extractionPct, belowYieldFlag };
}
