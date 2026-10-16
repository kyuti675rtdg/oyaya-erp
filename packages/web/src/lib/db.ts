import Dexie, { type Table } from 'dexie';

export interface OutboxEntry {
  /** Time-ordered UUIDv7 — primary key and server-side idempotency key. */
  clientUuid: string;
  /** Domain entity name, e.g. 'wheat-intake', 'tank-fill', 'shift-output', 'lab-check', 'piece-rate-log', 'dispatch'. */
  entity: string;
  /** API path relative to /api/v1, e.g. '/intakes'. */
  url: string;
  /** Full JSON payload (includes clientUuid). */
  data: Record<string, unknown>;
  /** Local timestamp (ms) — sync order is chronological. */
  ts: number;
  deviceId: string;
  attempts: number;
}

export class OyayaDb extends Dexie {
  outbox!: Table<OutboxEntry, string>;

  constructor() {
    super('oyaya-erp');
    this.version(1).stores({
      outbox: 'clientUuid, ts, entity'
    });
  }
}

export const db = new OyayaDb();
