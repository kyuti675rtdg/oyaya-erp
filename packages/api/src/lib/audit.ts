import type { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  userId?: string | null;
  action: string; // CREATE | UPDATE | DELETE | APPROVE | REJECT | POST | PAY | CLOSE | SIGNOFF | SYNC | ...
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
}

/** Write an immutable audit trail row inside the caller's transaction. */
export async function audit(db: DbClient, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      changes: (input.changes ?? {}) as Prisma.InputJsonValue,
    },
  });
}
