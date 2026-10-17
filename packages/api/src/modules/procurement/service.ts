import { Prisma, IntakeStatus, PieceStage } from '@prisma/client';
import { audit, type DbClient } from '../../lib/audit';
import { nextDocNo } from '../../lib/numbers';
import { AppError } from '../../middleware/errorHandler';

// Cross-module services built by sibling agents. Local typed signatures keep
// this module strict; calls go through `as unknown as` indirection below.
// Assumption: both take the caller's DbClient (transaction) as first arg.
import { queueSms, getPhonesForRoles } from '../sms/service';
import { postJournal } from '../finance/service';

interface SmsQueueInput {
  to: string;
  message: string;
  trigger?: string;
}

type QueueSmsFn = (db: DbClient, input: SmsQueueInput) => Promise<unknown>;
type GetPhonesForRolesFn = (db: DbClient, roleNames: string[]) => Promise<string[]>;

interface JournalLineInput {
  accountCode: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  memo?: string;
}

interface PostJournalInput {
  entryDate: Date;
  memo: string;
  module: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string;
  lines: JournalLineInput[];
}

type PostJournalFn = (db: DbClient, input: PostJournalInput) => Promise<unknown>;

async function queueSmsTx(_db: DbClient, input: SmsQueueInput): Promise<void> {
  await queueSms(input);
}

async function phonesForRoles(_db: DbClient, roleNames: string[]): Promise<string[]> {
  return getPhonesForRoles(roleNames);
}

async function postJournalTx(db: DbClient, input: PostJournalInput): Promise<void> {
  await postJournal(db, {
    entryDate: input.entryDate,
    memo: input.memo,
    module: input.module,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    createdById: input.createdById,
    lines: input.lines,
  });
}

// ─── Lab result ─────────────────────────────────────────────────

export interface LabResultInput {
  glutenPct: number;
  moisturePct: number;
  impurityPct: number;
  hectoliterPct: number;
  germinationPct: number;
}

interface ThresholdCheck {
  label: string;
  code: string;
  value: Prisma.Decimal;
  fallbackMin?: number;
  fallbackMax?: number;
}

/** Record the 5-parameter lab gate. Flags out-of-range intakes and SMSes the Quality / Lab Head. */
export async function recordLabResult(
  db: DbClient,
  intakeId: string,
  params: LabResultInput,
  uid: string,
) {
  const intake = await db.wheatIntake.findUnique({ where: { id: intakeId } });
  if (!intake) throw new AppError(404, 'Intake not found');
  if (intake.status !== IntakeStatus.PENDING_LAB && intake.status !== IntakeStatus.FLAGGED) {
    throw new AppError(409, 'Lab result can only be recorded while the intake is pending lab or flagged');
  }

  const thresholds = await db.qcThreshold.findMany({
    where: { category: 'intake', isActive: true },
  });
  const byCode = new Map(thresholds.map((t) => [t.code, t]));

  const checks: ThresholdCheck[] = [
    { label: 'gluten', code: 'intake.gluten.min', value: new Prisma.Decimal(params.glutenPct), fallbackMin: 20 },
    { label: 'moisture', code: 'intake.moisture.max', value: new Prisma.Decimal(params.moisturePct), fallbackMax: 13.5 },
    { label: 'impurity', code: 'intake.impurity.max', value: new Prisma.Decimal(params.impurityPct), fallbackMax: 6 },
    { label: 'hectoliter', code: 'intake.hectoliter.min', value: new Prisma.Decimal(params.hectoliterPct), fallbackMin: 74 },
    { label: 'germination', code: 'intake.germination.max', value: new Prisma.Decimal(params.germinationPct), fallbackMax: 1 },
  ];

  const reasons: string[] = [];
  for (const c of checks) {
    const t = byCode.get(c.code);
    const min = t?.minValue ?? (c.fallbackMin === undefined ? undefined : new Prisma.Decimal(c.fallbackMin));
    const max = t?.maxValue ?? (c.fallbackMax === undefined ? undefined : new Prisma.Decimal(c.fallbackMax));
    if (min !== undefined && c.value.lt(min)) {
      reasons.push(`${c.label} ${c.value.toFixed(2)} < min ${min.toFixed(2)}`);
    }
    if (max !== undefined && c.value.gt(max)) {
      reasons.push(`${c.label} ${c.value.toFixed(2)} > max ${max.toFixed(2)}`);
    }
  }

  const flagged = reasons.length > 0;
  const status = flagged ? IntakeStatus.FLAGGED : IntakeStatus.PENDING_LAB;

  const updated = await db.wheatIntake.update({
    where: { id: intakeId },
    data: {
      glutenPct: new Prisma.Decimal(params.glutenPct),
      moisturePct: new Prisma.Decimal(params.moisturePct),
      impurityPct: new Prisma.Decimal(params.impurityPct),
      hectoliterPct: new Prisma.Decimal(params.hectoliterPct),
      germinationPct: new Prisma.Decimal(params.germinationPct),
      labTestedAt: new Date(),
      labTestedById: uid,
      flaggedReasons: reasons,
      status,
    },
  });

  if (flagged) {
    const phones = await phonesForRoles(db, ['Quality / Lab Head']);
    const message = `[OYAYA ERP] Wheat intake ${intake.intakeNo} FLAGGED: ${reasons.join('; ')}. Quality Head review required.`;
    for (const to of phones) {
      await queueSmsTx(db, { to, message, trigger: 'INTAKE_FLAGGED' });
    }
  }

  await audit(db, {
    userId: uid,
    action: 'UPDATE',
    entityType: 'WheatIntake',
    entityId: intakeId,
    changes: { ...params, status, flaggedReasons: reasons },
  });

  return updated;
}

// ─── Executive decision ─────────────────────────────────────────

export interface DecideIntakeInput {
  decision: 'ACCEPT' | 'REJECT' | 'CONDITIONAL';
  note?: string;
  pricePerQuintalBirr?: number;
  returnNote?: string;
  granaryDumping?: Array<{ laborer: string; quintals: number }>;
}

/**
 * Explicit executive decision on an intake. ACCEPT / CONDITIONAL post the
 * dry-pool stock movement, the AP invoice and the purchase journal and advance
 * the linked purchase order; REJECT posts nothing and records return notes.
 */
export async function decideIntake(
  db: DbClient,
  intakeId: string,
  input: DecideIntakeInput,
  uid: string,
) {
  const intake = await db.wheatIntake.findUnique({
    where: { id: intakeId },
    include: { supplier: true, purchaseOrder: true },
  });
  if (!intake) throw new AppError(404, 'Intake not found');
  if (intake.status !== IntakeStatus.PENDING_LAB && intake.status !== IntakeStatus.FLAGGED) {
    throw new AppError(409, 'Intake has already been decided');
  }
  if (input.decision === 'REJECT' && !input.returnNote?.trim() && !input.note?.trim()) {
    throw new AppError(400, 'A return note or decision reason is required for rejection');
  }

  const accepted = input.decision !== 'REJECT';
  const status = accepted ? IntakeStatus.ACCEPTED : IntakeStatus.REJECTED;
  const updated = await db.wheatIntake.update({
    where: { id: intakeId },
    data: {
      decision: input.decision,
      decidedById: uid,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
      returnNote: input.decision === 'REJECT' ? (input.returnNote ?? input.note ?? null) : null,
      status,
    },
    include: { supplier: true },
  });

  if (accepted) {
    const price = new Prisma.Decimal(input.pricePerQuintalBirr ?? 400);
    const amount = intake.quintals.times(price);

    await db.storageMovement.create({
      data: {
        locationCode: 'DRY_POOL',
        direction: 'IN',
        quintals: intake.quintals,
        reference: intake.intakeNo,
        movedById: uid,
      },
    });

    await db.aPInvoice.create({
      data: {
        invoiceNo: await nextDocNo(db, 'apInvoice', 'invoiceNo', 'AP'),
        intakeId: intake.id,
        supplierId: intake.supplierId,
        amountBirr: amount,
        dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000), // net-30 default
      },
    });

    await postJournalTx(db, {
      entryDate: new Date(),
      memo: `Wheat intake ${intake.intakeNo} - ${intake.supplier.name}`,
      module: 'procurement',
      referenceType: 'WheatIntake',
      referenceId: intake.id,
      createdById: uid,
      lines: [
        { accountCode: '1200', debit: amount, credit: new Prisma.Decimal(0) },
        { accountCode: '2000', debit: new Prisma.Decimal(0), credit: amount },
      ],
    });

    // Advance linked purchase order
    if (intake.purchaseOrderId) {
      const po = await db.purchaseOrder.findUnique({ where: { id: intake.purchaseOrderId } });
      if (po) {
        const received = po.receivedQ.plus(intake.quintals);
        const complete = received.gte(po.quantityQ);
        await db.purchaseOrder.update({
          where: { id: po.id },
          data: {
            receivedQ: received,
            status: complete ? 'COMPLETED' : 'PARTIALLY_RECEIVED',
          },
        });
      }
    }

    for (const g of input.granaryDumping ?? []) {
      await db.pieceRateLog.create({
        data: {
          stage: PieceStage.GRANARY_DUMPING,
          laborer: g.laborer,
          quintals: new Prisma.Decimal(g.quintals),
          loggedById: uid,
        },
      });
    }
  }

  await audit(db, {
    userId: uid,
    action: input.decision === 'REJECT' ? 'REJECT' : 'APPROVE',
    entityType: 'WheatIntake',
    entityId: intake.id,
    changes: { decision: input.decision, status, note: input.note ?? null },
  });

  return updated;
}

// ─── AP invoice payment ─────────────────────────────────────────

export interface PayApInvoiceInput {
  amountBirr: number;
  method: 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
}

/** Issue a payment voucher against an AP invoice; posts Dr 2000 / Cr 1000. */
export async function payApInvoice(
  db: DbClient,
  apInvoiceId: string,
  input: PayApInvoiceInput,
  uid: string,
) {
  const invoice = await db.aPInvoice.findUnique({
    where: { id: apInvoiceId },
    include: { payments: true, intake: { include: { supplier: true } } },
  });
  if (!invoice) throw new AppError(404, 'AP invoice not found');

  let paid = new Prisma.Decimal(0);
  for (const p of invoice.payments) {
    paid = paid.plus(p.amountBirr);
  }
  const remaining = invoice.amountBirr.minus(paid);
  const amount = new Prisma.Decimal(input.amountBirr);
  if (amount.gt(remaining)) {
    throw new AppError(
      400,
      `Payment ${amount.toFixed(2)} ETB exceeds remaining balance ${remaining.toFixed(2)} ETB`,
    );
  }

  const voucherNo = await nextDocNo(db, 'apPayment', 'voucherNo', 'PV');
  const payment = await db.aPPayment.create({
    data: {
      voucherNo,
      apInvoiceId: invoice.id,
      amountBirr: amount,
      method: input.method,
      reference: input.reference ?? null,
      paidById: uid,
    },
  });

  const newStatus = paid.plus(amount).gte(invoice.amountBirr) ? 'PAID' : 'PARTIAL';
  await db.aPInvoice.update({ where: { id: invoice.id }, data: { status: newStatus } });

  await postJournalTx(db, {
    entryDate: new Date(),
    memo: `Payment voucher ${voucherNo} - intake ${invoice.intake.intakeNo}`,
    module: 'procurement',
    referenceType: 'APPayment',
    referenceId: payment.id,
    createdById: uid,
    lines: [
      { accountCode: '2000', debit: amount, credit: new Prisma.Decimal(0) },
      { accountCode: '1000', debit: new Prisma.Decimal(0), credit: amount },
    ],
  });

  if (invoice.intake.supplier.phone) {
    await queueSmsTx(db, {
      to: invoice.intake.supplier.phone,
      message: `[OYAYA ERP] Payment voucher ${voucherNo}: ${amount.toFixed(2)} ETB issued for wheat intake ${invoice.intake.intakeNo}.`,
      trigger: 'SUPPLIER_PAID',
    });
  }

  await audit(db, {
    userId: uid,
    action: 'PAY',
    entityType: 'APPayment',
    entityId: payment.id,
    changes: { voucherNo, amountBirr: amount.toFixed(2), invoiceId: invoice.id, status: newStatus },
  });

  return payment;
}
