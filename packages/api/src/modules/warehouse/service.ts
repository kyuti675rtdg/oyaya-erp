/**
 * Module 11 — Warehouse & Inventory Management (general warehouse engine).
 *
 * NOTE: until schema.prisma is merged with /tmp/schema-module11.prisma, the
 * generated Prisma client has no Wh* models. This service therefore talks to
 * the database with typed raw SQL (Prisma.$queryRawUnsafe), so the module
 * compiles today and keeps working byte-for-byte after the migration runs.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ── Types ────────────────────────────────────────────────────────────────────

export type WhLocationType = 'RAW' | 'FG' | 'SPARE' | 'GENERAL';
export type WhMovementType =
  | 'RECEIVE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUST_IN'
  | 'ADJUST_OUT'
  | 'ISSUE'
  | 'DISPATCH'
  | 'COUNT_IN'
  | 'COUNT_OUT';

export interface WhLocationRow {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  type: WhLocationType;
  capacityQ: number;
  isActive: boolean;
  onHandQ: number;
  utilizationPct: number | null;
}

export interface StockRow {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  reservedQ: number;
  availableQ: number;
}

interface RawNum {
  [k: string]: unknown;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function uid(): string {
  return randomUUID();
}

// Next document number, e.g. WH-PA-0007, computed inside a transaction.
async function nextDocNo(tx: Tx, table: string, col: string, prefix: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<Array<{ docNo: string }>>(
    `SELECT "${col}" AS "docNo" FROM "${table}" WHERE "${col}" LIKE $1 ORDER BY "${col}" DESC LIMIT 1`,
    `${prefix}%`,
  );
  let n = 0;
  if (rows[0]) {
    const m = /(\d+)\s*$/.exec(rows[0].docNo);
    if (m) n = parseInt(m[1], 10);
  }
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

// ── Stock helpers ────────────────────────────────────────────────────────────

// On-hand quantities keyed by `${locationId}|${productId}|${batchNo ?? ''}`.
async function onHandMap(
  tx: Tx,
  locationId?: string,
): Promise<Map<string, { quintals: number; bags: number }>> {
  const rows = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "locationId", "productId", COALESCE("batchNo",'') AS "batchNo",
            COALESCE(SUM("quintals"),0)::float AS "q",
            COALESCE(SUM("bags"),0) AS "b"
     FROM "WhStockLedger"
     ${locationId ? 'WHERE "locationId" = $1' : ''}
     GROUP BY "locationId","productId",COALESCE("batchNo",'')`,
    ...(locationId ? [locationId] : []),
  );
  const map = new Map<string, { quintals: number; bags: number }>();
  for (const r of rows) {
    map.set(`${r.locationId}|${r.productId}|${r.batchNo}`, {
      quintals: num(r.q),
      bags: num(r.b),
    });
  }
  return map;
}

// Active reservations keyed the same way (only counted when location given).
async function reservedMap(
  tx: Tx,
  locationId?: string,
): Promise<Map<string, number>> {
  const rows = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "locationId", "productId", COALESCE("batchNo",'') AS "batchNo",
            COALESCE(SUM("quintals"),0)::float AS "q"
     FROM "WhReservation"
     WHERE "status" = 'ACTIVE' ${locationId ? 'AND "locationId" = $1' : ''}
     GROUP BY "locationId","productId",COALESCE("batchNo",'')`,
    ...(locationId ? [locationId] : []),
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.locationId}|${r.productId}|${r.batchNo}`, num(r.q));
  return map;
}

const key3 = (l: string, p: string, b?: string | null) => `${l}|${p}|${b ?? ''}`;

/** Weighted-average unit cost for a location+product from inbound ledger lines. */
async function weightedAvgCost(tx: Tx, locationId: string, productId: string): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT COALESCE(SUM("quintals"),0)::float AS "q",
            COALESCE(SUM("quintals" * COALESCE("unitCostBirr",0)),0)::float AS "c"
     FROM "WhStockLedger"
     WHERE "locationId" = $1 AND "productId" = $2
       AND "quintals" > 0 AND "unitCostBirr" IS NOT NULL`,
    locationId,
    productId,
  );
  const q = num(rows[0]?.q);
  const c = num(rows[0]?.c);
  return q > 0 ? c / q : 0;
}

// ── 1. Locations ─────────────────────────────────────────────────────────────

export async function listLocations(): Promise<WhLocationRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT l."id", l."code", l."name", l."zone", l."type",
            l."capacityQ"::float AS "capacityQ", l."isActive",
            COALESCE(s."onHand",0)::float AS "onHandQ"
     FROM "WhLocation" l
     LEFT JOIN (SELECT "locationId", SUM("quintals") AS "onHand"
                FROM "WhStockLedger" GROUP BY "locationId") s
       ON s."locationId" = l."id"
     ORDER BY l."code" ASC`,
  );
  return rows.map((r) => {
    const cap = num(r.capacityQ);
    const on = num(r.onHandQ);
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      zone: r.zone == null ? null : String(r.zone),
      type: r.type as WhLocationType,
      capacityQ: cap,
      isActive: Boolean(r.isActive),
      onHandQ: on,
      utilizationPct: cap > 0 ? Math.round((on / cap) * 1000) / 10 : null,
    };
  });
}

export interface LocationInput {
  code: string;
  name: string;
  zone?: string | null;
  type?: WhLocationType;
  capacityQ?: number;
  isActive?: boolean;
}

export async function createLocation(userId: string, b: LocationInput): Promise<WhLocationRow> {
  const row = await prisma.$transaction(async (tx) => {
    const id = uid();
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhLocation" ("id","code","name","zone","type","capacityQ","isActive")
       VALUES ($1,$2,$3,$4,$5::"WhLocationType",$6,$7)`,
      id,
      b.code,
      b.name,
      b.zone ?? null,
      b.type ?? 'GENERAL',
      b.capacityQ ?? 0,
      b.isActive ?? true,
    );
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhLocation',
      entityId: id,
      changes: { code: b.code, name: b.name },
    });
    return id;
  });
  const all = await listLocations();
  const created = all.find((l) => l.id === row);
  if (!created) throw new AppError(500, 'Location created but could not be re-read');
  return created;
}

export async function updateLocation(
  userId: string,
  id: string,
  b: Partial<LocationInput>,
): Promise<WhLocationRow> {
  await prisma.$transaction(async (tx) => {
    const found = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "WhLocation" WHERE "id" = $1`,
      id,
    );
    if (!found[0]) throw new AppError(404, 'Warehouse location not found');
    const sets: string[] = ['"updatedAt" = CURRENT_TIMESTAMP'];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown, cast?: string) => {
      vals.push(v);
      sets.push(`"${col}" = $${vals.length}${cast ?? ''}`);
    };
    if (b.name !== undefined) push('name', b.name);
    if (b.zone !== undefined) push('zone', b.zone);
    if (b.type !== undefined) push('type', b.type, '::"WhLocationType"');
    if (b.capacityQ !== undefined) push('capacityQ', b.capacityQ);
    if (b.isActive !== undefined) push('isActive', b.isActive);
    if (sets.length > 1) {
      await tx.$executeRawUnsafe(
        `UPDATE "WhLocation" SET ${sets.join(', ')} WHERE "id" = $${vals.length + 1}`,
        ...vals,
        id,
      );
      await audit(tx, { userId, action: 'UPDATE', entityType: 'WhLocation', entityId: id, changes: b });
    }
  });
  const all = await listLocations();
  const updated = all.find((l) => l.id === id);
  if (!updated) throw new AppError(404, 'Warehouse location not found');
  return updated;
}

// Seed a sensible default location set when the warehouse is empty.
export async function seedDefaultLocations(userId: string): Promise<WhLocationRow[]> {
  const existing = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*) AS "c" FROM "WhLocation"`,
  );
  if (Number(existing[0]?.c ?? 0) > 0) throw new AppError(409, 'Locations already exist');
  const defaults: LocationInput[] = [
    { code: 'WH-RM-A', name: 'Raw Material Store A', zone: 'North Wing', type: 'RAW', capacityQ: 4000 },
    { code: 'WH-RM-B', name: 'Raw Material Store B', zone: 'North Wing', type: 'RAW', capacityQ: 4000 },
    { code: 'WH-FG-01', name: 'Finished Goods Store 1', zone: 'South Wing', type: 'FG', capacityQ: 3000 },
    { code: 'WH-FG-02', name: 'Finished Goods Store 2', zone: 'South Wing', type: 'FG', capacityQ: 3000 },
    { code: 'WH-SP-01', name: 'Spare Parts Store', zone: 'East Wing', type: 'SPARE', capacityQ: 500 },
    { code: 'WH-GN-01', name: 'General Store', zone: 'East Wing', type: 'GENERAL', capacityQ: 1000 },
  ];
  await prisma.$transaction(async (tx) => {
    for (const d of defaults) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhLocation" ("id","code","name","zone","type","capacityQ","isActive")
         VALUES ($1,$2,$3,$4,$5::"WhLocationType",$6,TRUE)`,
        uid(),
        d.code,
        d.name,
        d.zone ?? null,
        d.type,
        d.capacityQ,
      );
    }
    await audit(tx, {
      userId,
      action: 'SEED',
      entityType: 'WhLocation',
      entityId: null,
      changes: { seeded: defaults.map((d) => d.code) },
    });
  });
  return listLocations();
}

// ── Stock view ───────────────────────────────────────────────────────────────

export async function stockView(opts: {
  locationId?: string;
  productId?: string;
}): Promise<StockRow[]> {
  return prisma.$transaction(async (tx) => {
    const on = await onHandMap(tx, opts.locationId);
    const res = await reservedMap(tx, opts.locationId);
    const locRows = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","code","name" FROM "WhLocation" ${opts.locationId ? 'WHERE "id" = $1' : ''}`,
      ...(opts.locationId ? [opts.locationId] : []),
    );
    const prodRows = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","name" FROM "Product" WHERE "isActive" = TRUE ${opts.productId ? 'AND "id" = $1' : ''}`,
      ...(opts.productId ? [opts.productId] : []),
    );
    const locName = new Map(locRows.map((l) => [String(l.id), { code: String(l.code), name: String(l.name) }]));
    const prodName = new Map(prodRows.map((p) => [String(p.id), String(p.name)]));
    const out: StockRow[] = [];
    for (const [k, v] of on) {
      const [l, p, b] = k.split('|');
      if (opts.productId && p !== opts.productId) continue;
      if (Math.abs(v.quintals) < 0.005 && Math.abs(v.bags) < 1) continue;
      const loc = locName.get(l);
      if (!loc) continue;
      const reserved = res.get(k) ?? 0;
      out.push({
        locationId: l,
        locationCode: loc.code,
        locationName: loc.name,
        productId: p,
        productName: prodName.get(p) ?? p,
        batchNo: b === '' ? null : b,
        quintals: Math.round(v.quintals * 100) / 100,
        bags: v.bags,
        reservedQ: Math.round(reserved * 100) / 100,
        availableQ: Math.round((v.quintals - reserved) * 100) / 100,
      });
    }
    out.sort((a, b) => a.locationCode.localeCompare(b.locationCode) || a.productName.localeCompare(b.productName));
    return out;
  });
}

// Suggest a put-away location: active location of the preferred type with the
// most free capacity (quintals).
export async function suggestLocation(
  preferredType: WhLocationType,
): Promise<{ id: string; code: string; name: string } | null> {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT l."id", l."code", l."name",
            (l."capacityQ"::float - COALESCE(s."onHand",0)::float) AS "freeQ"
     FROM "WhLocation" l
     LEFT JOIN (SELECT "locationId", SUM("quintals") AS "onHand"
                FROM "WhStockLedger" GROUP BY "locationId") s
       ON s."locationId" = l."id"
     WHERE l."isActive" = TRUE AND l."type" = $1::"WhLocationType"
     ORDER BY "freeQ" DESC LIMIT 1`,
    preferredType,
  );
  if (!rows[0]) return null;
  return { id: String(rows[0].id), code: String(rows[0].code), name: String(rows[0].name) };
}

// ── 2. Goods receiving & put-away ────────────────────────────────────────────

export interface PutAwayItemInput {
  productId: string;
  batchNo?: string | null;
  quintals: number;
  bags?: number;
  packagingKg?: number | null;
  unitCostBirr?: number | null;
}

export async function listPutAways(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT p."id", p."docNo", p."referenceDoc", p."status", p."receivedAt",
            COUNT(i."id") AS "itemCount",
            COALESCE(SUM(i."quintals"),0)::float AS "totalQ"
     FROM "WhPutAway" p
     LEFT JOIN "WhPutAwayItem" i ON i."putAwayId" = p."id"
     ${status ? 'WHERE p."status" = $1::"WhPutAwayStatus"' : ''}
     GROUP BY p."id"
     ORDER BY p."receivedAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    docNo: String(r.docNo),
    referenceDoc: r.referenceDoc == null ? null : String(r.referenceDoc),
    status: String(r.status),
    receivedAt: r.receivedAt,
    itemCount: num(r.itemCount),
    totalQ: num(r.totalQ),
  }));
}

export async function getPutAway(id: string) {
  const heads = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "id","docNo","referenceDoc","status","receivedAt" FROM "WhPutAway" WHERE "id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Put-away document not found');
  const items = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT i."id", i."productId", pr."name" AS "productName", i."batchNo",
            i."quintals"::float AS "quintals", i."bags", i."packagingKg",
            i."unitCostBirr"::float AS "unitCostBirr",
            i."suggestedLocationId", sl."code" AS "suggestedCode",
            i."placedLocationId", pl."code" AS "placedCode", i."placedAt"
     FROM "WhPutAwayItem" i
     JOIN "Product" pr ON pr."id" = i."productId"
     LEFT JOIN "WhLocation" sl ON sl."id" = i."suggestedLocationId"
     LEFT JOIN "WhLocation" pl ON pl."id" = i."placedLocationId"
     WHERE i."putAwayId" = $1 ORDER BY i."id"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    docNo: String(h.docNo),
    referenceDoc: h.referenceDoc == null ? null : String(h.referenceDoc),
    status: String(h.status),
    receivedAt: h.receivedAt,
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.productId),
      productName: String(i.productName),
      batchNo: i.batchNo == null ? null : String(i.batchNo),
      quintals: num(i.quintals),
      bags: num(i.bags),
      packagingKg: i.packagingKg == null ? null : num(i.packagingKg),
      unitCostBirr: i.unitCostBirr == null ? null : num(i.unitCostBirr),
      suggestedLocationId: i.suggestedLocationId == null ? null : String(i.suggestedLocationId),
      suggestedCode: i.suggestedCode == null ? null : String(i.suggestedCode),
      placedLocationId: i.placedLocationId == null ? null : String(i.placedLocationId),
      placedCode: i.placedCode == null ? null : String(i.placedCode),
      placedAt: i.placedAt ?? null,
    })),
  };
}

export async function createPutAway(
  userId: string,
  b: { referenceDoc?: string | null; items: PutAwayItemInput[] },
) {
  if (!b.items?.length) throw new AppError(400, 'At least one item is required');
  return prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'WhPutAway', 'docNo', 'WH-PA-');
    const id = uid();
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhPutAway" ("id","docNo","referenceDoc","status","createdById")
       VALUES ($1,$2,$3,'DRAFT',$4)`,
      id,
      docNo,
      b.referenceDoc ?? null,
      userId,
    );
    // Suggest locations: flour-like products → FG store, wheat-like → RAW store.
    const prodKinds = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","kind" FROM "Product" WHERE "id" = ANY($1::text[])`,
      b.items.map((i) => i.productId),
    );
    const kindOf = new Map(prodKinds.map((p) => [String(p.id), String(p.kind)]));
    for (const it of b.items) {
      const kind = (kindOf.get(it.productId) ?? '').toLowerCase();
      const preferred: WhLocationType = kind.includes('flour') ? 'FG' : kind.includes('wheat') ? 'RAW' : 'GENERAL';
      let suggested = await suggestLocation(preferred);
      if (!suggested && preferred !== 'GENERAL') suggested = await suggestLocation('GENERAL');
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhPutAwayItem"
           ("id","putAwayId","productId","batchNo","quintals","bags","packagingKg","unitCostBirr","suggestedLocationId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        uid(),
        id,
        it.productId,
        it.batchNo ?? null,
        it.quintals,
        it.bags ?? 0,
        it.packagingKg ?? null,
        it.unitCostBirr ?? null,
        suggested?.id ?? null,
      );
    }
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhPutAway',
      entityId: id,
      changes: { docNo, referenceDoc: b.referenceDoc ?? null, lines: b.items.length },
    });
    return getPutAwayTx(tx, id);
  });
}

// Re-read a put-away inside a transaction (used by create/place).
async function getPutAwayTx(tx: Tx, id: string) {
  const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "id","docNo","referenceDoc","status","receivedAt" FROM "WhPutAway" WHERE "id" = $1`,
    id,
  );
  const items = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT i."id", i."productId", pr."name" AS "productName", i."batchNo",
            i."quintals"::float AS "quintals", i."bags", i."packagingKg",
            i."unitCostBirr"::float AS "unitCostBirr",
            i."suggestedLocationId", sl."code" AS "suggestedCode",
            i."placedLocationId", pl."code" AS "placedCode", i."placedAt"
     FROM "WhPutAwayItem" i
     JOIN "Product" pr ON pr."id" = i."productId"
     LEFT JOIN "WhLocation" sl ON sl."id" = i."suggestedLocationId"
     LEFT JOIN "WhLocation" pl ON pl."id" = i."placedLocationId"
     WHERE i."putAwayId" = $1 ORDER BY i."id"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    docNo: String(h.docNo),
    referenceDoc: h.referenceDoc == null ? null : String(h.referenceDoc),
    status: String(h.status),
    receivedAt: h.receivedAt,
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.productId),
      productName: String(i.productName),
      batchNo: i.batchNo == null ? null : String(i.batchNo),
      quintals: num(i.quintals),
      bags: num(i.bags),
      packagingKg: i.packagingKg == null ? null : num(i.packagingKg),
      unitCostBirr: i.unitCostBirr == null ? null : num(i.unitCostBirr),
      suggestedLocationId: i.suggestedLocationId == null ? null : String(i.suggestedLocationId),
      suggestedCode: i.suggestedCode == null ? null : String(i.suggestedCode),
      placedLocationId: i.placedLocationId == null ? null : String(i.placedLocationId),
      placedCode: i.placedCode == null ? null : String(i.placedCode),
      placedAt: i.placedAt ?? null,
    })),
  };
}

export async function placePutAway(
  userId: string,
  id: string,
  placements: Array<{ itemId: string; locationId: string }>,
) {
  return prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","docNo","status" FROM "WhPutAway" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Put-away document not found');
    if (String(heads[0].status) !== 'DRAFT') throw new AppError(409, 'Only DRAFT put-away can be placed');
    const items = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","productId","batchNo","quintals"::float AS "quintals","bags",
              "unitCostBirr"::float AS "unitCostBirr","suggestedLocationId"
       FROM "WhPutAwayItem" WHERE "putAwayId" = $1`,
      id,
    );
    if (!items.length) throw new AppError(400, 'Put-away has no items');
    const placeBy = new Map(placements.map((p) => [p.itemId, p.locationId]));
    for (const it of items) {
      const locId = placeBy.get(String(it.id)) ?? (it.suggestedLocationId == null ? null : String(it.suggestedLocationId));
      if (!locId) throw new AppError(400, `No placement location for item ${it.id}`);
      const loc = await tx.$queryRawUnsafe<Array<{ isActive: boolean }>>(
        `SELECT "isActive" FROM "WhLocation" WHERE "id" = $1`,
        locId,
      );
      if (!loc[0] || !loc[0].isActive) throw new AppError(400, 'Placement location is inactive or missing');
      await tx.$executeRawUnsafe(
        `UPDATE "WhPutAwayItem" SET "placedLocationId" = $1, "placedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        locId,
        String(it.id),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhStockLedger"
           ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr",
            "movementType","reference","refId","createdById")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'RECEIVE',$8,$9,$10)`,
        uid(),
        locId,
        String(it.productId),
        it.batchNo == null ? null : String(it.batchNo),
        num(it.quintals),
        num(it.bags),
        it.unitCostBirr == null ? null : num(it.unitCostBirr),
        String(heads[0].docNo),
        id,
        userId,
      );
    }
    await tx.$executeRawUnsafe(`UPDATE "WhPutAway" SET "status" = 'PLACED' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'POST',
      entityType: 'WhPutAway',
      entityId: id,
      changes: { docNo: String(heads[0].docNo), placed: items.length },
    });
    return getPutAwayTx(tx, id);
  });
}

// ── 3. Stock transfers ───────────────────────────────────────────────────────

export interface TransferItemInput {
  productId: string;
  batchNo?: string | null;
  quintals: number;
  bags?: number;
}

export async function listTransfers(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT t."id", t."docNo", t."reason", t."status", t."createdAt",
            fl."code" AS "fromCode", tl."code" AS "toCode",
            COUNT(i."id") AS "itemCount",
            COALESCE(SUM(i."quintals"),0)::float AS "totalQ"
     FROM "WhStockTransfer" t
     JOIN "WhLocation" fl ON fl."id" = t."fromLocationId"
     JOIN "WhLocation" tl ON tl."id" = t."toLocationId"
     LEFT JOIN "WhStockTransferItem" i ON i."transferId" = t."id"
     ${status ? 'WHERE t."status" = $1::"WhTransferStatus"' : ''}
     GROUP BY t."id", fl."code", tl."code"
     ORDER BY t."createdAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    docNo: String(r.docNo),
    fromCode: String(r.fromCode),
    toCode: String(r.toCode),
    reason: r.reason == null ? null : String(r.reason),
    status: String(r.status),
    createdAt: r.createdAt,
    itemCount: num(r.itemCount),
    totalQ: num(r.totalQ),
  }));
}

export async function getTransfer(id: string) {
  const heads = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT t."id", t."docNo", t."reason", t."status", t."createdAt", t."completedAt",
            fl."code" AS "fromCode", fl."name" AS "fromName",
            tl."code" AS "toCode", tl."name" AS "toName"
     FROM "WhStockTransfer" t
     JOIN "WhLocation" fl ON fl."id" = t."fromLocationId"
     JOIN "WhLocation" tl ON tl."id" = t."toLocationId"
     WHERE t."id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Stock transfer not found');
  const items = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT i."id", i."productId", pr."name" AS "productName", i."batchNo",
            i."quintals"::float AS "quintals", i."bags"
     FROM "WhStockTransferItem" i
     JOIN "Product" pr ON pr."id" = i."productId"
     WHERE i."transferId" = $1 ORDER BY i."id"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    docNo: String(h.docNo),
    fromCode: String(h.fromCode),
    fromName: String(h.fromName),
    toCode: String(h.toCode),
    toName: String(h.toName),
    reason: h.reason == null ? null : String(h.reason),
    status: String(h.status),
    createdAt: h.createdAt,
    completedAt: h.completedAt ?? null,
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.productId),
      productName: String(i.productName),
      batchNo: i.batchNo == null ? null : String(i.batchNo),
      quintals: num(i.quintals),
      bags: num(i.bags),
    })),
  };
}

async function assertAvailable(
  tx: Tx,
  locationId: string,
  productId: string,
  batchNo: string | null,
  quintals: number,
) {
  const on = await onHandMap(tx, locationId);
  const res = await reservedMap(tx, locationId);
  const have = on.get(key3(locationId, productId, batchNo));
  const avail = (have?.quintals ?? 0) - (res.get(key3(locationId, productId, batchNo)) ?? 0);
  if (avail + 1e-9 < quintals) {
    throw new AppError(409, `Insufficient available stock (have ${avail.toFixed(2)} Qt, need ${quintals.toFixed(2)} Qt)`);
  }
}

export async function createTransfer(
  userId: string,
  b: { fromLocationId: string; toLocationId: string; reason?: string | null; items: TransferItemInput[] },
) {
  if (b.fromLocationId === b.toLocationId) throw new AppError(400, 'Source and destination must differ');
  if (!b.items?.length) throw new AppError(400, 'At least one item is required');
  const id = uid();
  await prisma.$transaction(async (tx) => {
    for (const it of b.items) {
      await assertAvailable(tx, b.fromLocationId, it.productId, it.batchNo ?? null, it.quintals);
    }
    const docNo = await nextDocNo(tx, 'WhStockTransfer', 'docNo', 'WH-TR-');
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhStockTransfer" ("id","docNo","fromLocationId","toLocationId","reason","status","requestedById")
       VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6)`,
      id,
      docNo,
      b.fromLocationId,
      b.toLocationId,
      b.reason ?? null,
      userId,
    );
    for (const it of b.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhStockTransferItem" ("id","transferId","productId","batchNo","quintals","bags")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        uid(),
        id,
        it.productId,
        it.batchNo ?? null,
        it.quintals,
        it.bags ?? 0,
      );
    }
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhStockTransfer',
      entityId: id,
      changes: { docNo, lines: b.items.length },
    });
  });
  return getTransfer(id);
}

export async function transitionTransfer(userId: string, id: string, to: 'APPROVED' | 'COMPLETED' | 'REJECTED' | 'CANCELLED') {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","docNo","status","fromLocationId","toLocationId" FROM "WhStockTransfer" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Stock transfer not found');
    const h = heads[0];
    const from = String(h.status);
    const ok =
      (to === 'APPROVED' && from === 'REQUESTED') ||
      (to === 'COMPLETED' && from === 'APPROVED') ||
      (to === 'REJECTED' && from === 'REQUESTED') ||
      (to === 'CANCELLED' && (from === 'REQUESTED' || from === 'APPROVED'));
    if (!ok) throw new AppError(409, `Cannot move transfer from ${from} to ${to}`);
    if (to === 'COMPLETED') {
      const items = await tx.$queryRawUnsafe<Array<RawNum>>(
        `SELECT "productId","batchNo","quintals"::float AS "quintals","bags"
         FROM "WhStockTransferItem" WHERE "transferId" = $1`,
        id,
      );
      for (const it of items) {
        await assertAvailable(tx, String(h.fromLocationId), String(it.productId), it.batchNo == null ? null : String(it.batchNo), num(it.quintals));
      }
      for (const it of items) {
        const avg = await weightedAvgCost(tx, String(h.fromLocationId), String(it.productId));
        const batchNo = it.batchNo == null ? null : String(it.batchNo);
        await tx.$executeRawUnsafe(
          `INSERT INTO "WhStockLedger"
             ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr","movementType","reference","refId","createdById")
           VALUES ($1,$2,$3,$4,$5,$6,$7,'TRANSFER_OUT',$8,$9,$10)`,
          uid(), String(h.fromLocationId), String(it.productId), batchNo,
          -num(it.quintals), -num(it.bags), avg, String(h.docNo), id, userId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "WhStockLedger"
             ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr","movementType","reference","refId","createdById")
           VALUES ($1,$2,$3,$4,$5,$6,$7,'TRANSFER_IN',$8,$9,$10)`,
          uid(), String(h.toLocationId), String(it.productId), batchNo,
          num(it.quintals), num(it.bags), avg, String(h.docNo), id, userId,
        );
      }
      await tx.$executeRawUnsafe(
        `UPDATE "WhStockTransfer" SET "status" = 'COMPLETED', "approvedById" = COALESCE("approvedById",$2), "completedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        id,
        userId,
      );
    } else {
      const extra = to === 'APPROVED' ? `, "approvedById" = $2` : '';
      await tx.$executeRawUnsafe(
        `UPDATE "WhStockTransfer" SET "status" = $3${extra} WHERE "id" = $1`,
        id,
        userId,
        to,
      );
    }
    await audit(tx, {
      userId,
      action: to === 'APPROVED' ? 'APPROVE' : to === 'COMPLETED' ? 'POST' : 'UPDATE',
      entityType: 'WhStockTransfer',
      entityId: id,
      changes: { docNo: String(h.docNo), from: String(h.status), to },
    });
  });
  return getTransfer(id);
}

// ── 4. Inventory adjustments ─────────────────────────────────────────────────

// Small adjustments post immediately; anything above the threshold needs a
// warehouse:approve holder to sign off.
export const ADJUST_AUTO_POST_Q = 10;

export interface AdjustItemInput {
  productId: string;
  batchNo?: string | null;
  quintals: number; // signed
  bags?: number;
  unitCostBirr?: number | null;
  reason: 'DAMAGE' | 'FOUND' | 'RECOUNT' | 'SPOILAGE' | 'OTHER';
}

async function postAdjustmentTx(tx: Tx, userId: string, id: string, docNo: string, locationId: string) {
  const items = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "productId","batchNo","quintals"::float AS "quintals","bags",
            "unitCostBirr"::float AS "unitCostBirr","reason"
     FROM "WhAdjustmentItem" WHERE "adjustmentId" = $1`,
    id,
  );
  for (const it of items) {
    const q = num(it.quintals);
    if (Math.abs(q) < 0.005) continue;
    if (q < 0) {
      await assertAvailable(tx, locationId, String(it.productId), it.batchNo == null ? null : String(it.batchNo), -q);
    }
    const cost = it.unitCostBirr == null ? await weightedAvgCost(tx, locationId, String(it.productId)) : num(it.unitCostBirr);
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhStockLedger"
         ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr","movementType","reference","refId","createdById")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      uid(), locationId, String(it.productId),
      it.batchNo == null ? null : String(it.batchNo),
      q, num(it.bags), cost,
      q > 0 ? 'ADJUST_IN' : 'ADJUST_OUT',
      docNo, id, userId,
    );
  }
  await tx.$executeRawUnsafe(
    `UPDATE "WhAdjustment" SET "status" = 'POSTED', "approvedById" = $2, "postedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    id,
    userId,
  );
}

export async function listAdjustments(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT a."id", a."docNo", a."status", a."reason", a."createdAt",
            l."code" AS "locationCode",
            COUNT(i."id") AS "itemCount",
            COALESCE(SUM(ABS(i."quintals")),0)::float AS "totalAbsQ"
     FROM "WhAdjustment" a
     JOIN "WhLocation" l ON l."id" = a."locationId"
     LEFT JOIN "WhAdjustmentItem" i ON i."adjustmentId" = a."id"
     ${status ? 'WHERE a."status" = $1::"WhAdjustStatus"' : ''}
     GROUP BY a."id", l."code"
     ORDER BY a."createdAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    docNo: String(r.docNo),
    locationCode: String(r.locationCode),
    status: String(r.status),
    reason: r.reason == null ? null : String(r.reason),
    createdAt: r.createdAt,
    itemCount: num(r.itemCount),
    totalAbsQ: num(r.totalAbsQ),
  }));
}

export async function getAdjustment(id: string) {
  const heads = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT a."id", a."docNo", a."status", a."reason", a."createdAt", a."postedAt",
            l."code" AS "locationCode", l."name" AS "locationName"
     FROM "WhAdjustment" a JOIN "WhLocation" l ON l."id" = a."locationId"
     WHERE a."id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Adjustment not found');
  const items = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT i."id", i."productId", pr."name" AS "productName", i."batchNo",
            i."quintals"::float AS "quintals", i."bags",
            i."unitCostBirr"::float AS "unitCostBirr", i."reason"
     FROM "WhAdjustmentItem" i
     JOIN "Product" pr ON pr."id" = i."productId"
     WHERE i."adjustmentId" = $1 ORDER BY i."id"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    docNo: String(h.docNo),
    locationCode: String(h.locationCode),
    locationName: String(h.locationName),
    status: String(h.status),
    reason: h.reason == null ? null : String(h.reason),
    createdAt: h.createdAt,
    postedAt: h.postedAt ?? null,
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.productId),
      productName: String(i.productName),
      batchNo: i.batchNo == null ? null : String(i.batchNo),
      quintals: num(i.quintals),
      bags: num(i.bags),
      unitCostBirr: i.unitCostBirr == null ? null : num(i.unitCostBirr),
      reason: String(i.reason),
    })),
  };
}

export async function createAdjustment(
  userId: string,
  b: { locationId: string; reason?: string | null; items: AdjustItemInput[] },
) {
  if (!b.items?.length) throw new AppError(400, 'At least one item is required');
  if (b.items.some((i) => Math.abs(i.quintals) < 0.005)) throw new AppError(400, 'Adjustment quantity cannot be zero');
  const id = uid();
  let docNo = '';
  let posted = false;
  await prisma.$transaction(async (tx) => {
    docNo = await nextDocNo(tx, 'WhAdjustment', 'docNo', 'WH-AD-');
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhAdjustment" ("id","docNo","locationId","status","reason","createdById")
       VALUES ($1,$2,$3,'PENDING',$4,$5)`,
      id,
      docNo,
      b.locationId,
      b.reason ?? null,
      userId,
    );
    for (const it of b.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhAdjustmentItem"
           ("id","adjustmentId","productId","batchNo","quintals","bags","unitCostBirr","reason")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"WhAdjustReason")`,
        uid(), id, it.productId, it.batchNo ?? null,
        it.quintals, it.bags ?? 0, it.unitCostBirr ?? null, it.reason,
      );
    }
    const needsApproval = b.items.some((i) => Math.abs(i.quintals) > ADJUST_AUTO_POST_Q);
    if (!needsApproval) {
      await postAdjustmentTx(tx, userId, id, docNo, b.locationId);
      posted = true;
    }
    await audit(tx, {
      userId,
      action: posted ? 'POST' : 'CREATE',
      entityType: 'WhAdjustment',
      entityId: id,
      changes: { docNo, autoPosted: posted, lines: b.items.length },
    });
  });
  return { docNo, posted, adjustment: await getAdjustment(id) };
}

export async function approveAdjustment(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","docNo","status","locationId" FROM "WhAdjustment" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Adjustment not found');
    if (String(heads[0].status) !== 'PENDING') throw new AppError(409, 'Only PENDING adjustments can be approved');
    await postAdjustmentTx(tx, userId, id, String(heads[0].docNo), String(heads[0].locationId));
    await audit(tx, {
      userId,
      action: 'APPROVE',
      entityType: 'WhAdjustment',
      entityId: id,
      changes: { docNo: String(heads[0].docNo) },
    });
  });
  return getAdjustment(id);
}

export async function rejectAdjustment(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<{ status: string; docNo: string }>>(
      `SELECT "status","docNo" FROM "WhAdjustment" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Adjustment not found');
    if (heads[0].status !== 'PENDING') throw new AppError(409, 'Only PENDING adjustments can be rejected');
    await tx.$executeRawUnsafe(`UPDATE "WhAdjustment" SET "status" = 'REJECTED' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'REJECT',
      entityType: 'WhAdjustment',
      entityId: id,
      changes: { docNo: heads[0].docNo },
    });
  });
  return getAdjustment(id);
}

// ── 5. Reservations ──────────────────────────────────────────────────────────

export async function listReservations(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT r."id", r."refNo", r."reference", r."batchNo",
            r."quintals"::float AS "quintals", r."bags",
            r."expiresAt", r."status", r."createdAt",
            pr."name" AS "productName", l."code" AS "locationCode"
     FROM "WhReservation" r
     JOIN "Product" pr ON pr."id" = r."productId"
     JOIN "WhLocation" l ON l."id" = r."locationId"
     ${status ? 'WHERE r."status" = $1::"WhReserveStatus"' : ''}
     ORDER BY r."createdAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    refNo: String(r.refNo),
    reference: r.reference == null ? null : String(r.reference),
    productName: String(r.productName),
    batchNo: r.batchNo == null ? null : String(r.batchNo),
    locationCode: String(r.locationCode),
    quintals: num(r.quintals),
    bags: num(r.bags),
    expiresAt: r.expiresAt ?? null,
    status: String(r.status),
    createdAt: r.createdAt,
  }));
}

export async function createReservation(
  userId: string,
  b: {
    reference?: string | null;
    productId: string;
    batchNo?: string | null;
    locationId: string;
    quintals: number;
    bags?: number;
    expiresAt?: string | null;
  },
) {
  if (!(b.quintals > 0)) throw new AppError(400, 'Reservation quantity must be positive');
  const id = uid();
  let refNo = '';
  await prisma.$transaction(async (tx) => {
    await assertAvailable(tx, b.locationId, b.productId, b.batchNo ?? null, b.quintals);
    refNo = await nextDocNo(tx, 'WhReservation', 'refNo', 'WH-RS-');
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhReservation"
         ("id","refNo","reference","productId","batchNo","locationId","quintals","bags","expiresAt","status","createdById")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10)`,
      id, refNo, b.reference ?? null, b.productId, b.batchNo ?? null,
      b.locationId, b.quintals, b.bags ?? 0, b.expiresAt ?? null, userId,
    );
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhReservation',
      entityId: id,
      changes: { refNo, quintals: b.quintals },
    });
  });
  return { refNo, id };
}

export async function releaseReservation(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<{ status: string; refNo: string }>>(
      `SELECT "status","refNo" FROM "WhReservation" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Reservation not found');
    if (heads[0].status !== 'ACTIVE') throw new AppError(409, 'Only ACTIVE reservations can be released');
    await tx.$executeRawUnsafe(
      `UPDATE "WhReservation" SET "status" = 'RELEASED', "releasedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      id,
    );
    await audit(tx, {
      userId,
      action: 'UPDATE',
      entityType: 'WhReservation',
      entityId: id,
      changes: { refNo: heads[0].refNo, to: 'RELEASED' },
    });
  });
  return { ok: true };
}

export async function consumeReservation(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<{ status: string; refNo: string }>>(
      `SELECT "status","refNo" FROM "WhReservation" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Reservation not found');
    if (heads[0].status !== 'ACTIVE') throw new AppError(409, 'Only ACTIVE reservations can be consumed');
    await tx.$executeRawUnsafe(`UPDATE "WhReservation" SET "status" = 'CONSUMED' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'UPDATE',
      entityType: 'WhReservation',
      entityId: id,
      changes: { refNo: heads[0].refNo, to: 'CONSUMED' },
    });
  });
  return { ok: true };
}

// Mark overdue ACTIVE reservations EXPIRED; returns the count.
export async function expireReservations(userId: string | null): Promise<number> {
  const res = await prisma.$executeRawUnsafe(
    `UPDATE "WhReservation" SET "status" = 'EXPIRED', "releasedAt" = CURRENT_TIMESTAMP
     WHERE "status" = 'ACTIVE' AND "expiresAt" IS NOT NULL AND "expiresAt" < CURRENT_TIMESTAMP`,
  );
  const count = Number(res);
  if (count > 0) {
    await prisma.$transaction(async (tx) => {
      await audit(tx, {
        userId,
        action: 'EXPIRE',
        entityType: 'WhReservation',
        entityId: null,
        changes: { expired: count },
      });
    });
  }
  return Number.isFinite(count) ? count : 0;
}

// ── 6. Dispatch ──────────────────────────────────────────────────────────────

export interface DispatchItemInput {
  productId: string;
  batchNo?: string | null;
  locationId: string;
  quintals: number;
  bags?: number;
  reservationId?: string | null;
}

export async function listDispatches(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT d."id", d."docNo", d."reference", d."vehiclePlate", d."driverName",
            d."status", d."createdAt", d."dispatchedAt",
            COUNT(i."id") AS "itemCount",
            COALESCE(SUM(i."quintals"),0)::float AS "totalQ"
     FROM "WhDispatch" d
     LEFT JOIN "WhDispatchItem" i ON i."dispatchId" = d."id"
     ${status ? 'WHERE d."status" = $1::"WhDispatchStatus"' : ''}
     GROUP BY d."id"
     ORDER BY d."createdAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    docNo: String(r.docNo),
    reference: r.reference == null ? null : String(r.reference),
    vehiclePlate: r.vehiclePlate == null ? null : String(r.vehiclePlate),
    driverName: r.driverName == null ? null : String(r.driverName),
    status: String(r.status),
    createdAt: r.createdAt,
    dispatchedAt: r.dispatchedAt ?? null,
    itemCount: num(r.itemCount),
    totalQ: num(r.totalQ),
  }));
}

export async function getDispatch(id: string) {
  const heads = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "id","docNo","reference","vehiclePlate","driverName","status","createdAt","dispatchedAt"
     FROM "WhDispatch" WHERE "id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Dispatch not found');
  const items = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT i."id", i."productId", pr."name" AS "productName", i."batchNo",
            i."locationId", l."code" AS "locationCode",
            i."quintals"::float AS "quintals", i."bags"
     FROM "WhDispatchItem" i
     JOIN "Product" pr ON pr."id" = i."productId"
     JOIN "WhLocation" l ON l."id" = i."locationId"
     WHERE i."dispatchId" = $1 ORDER BY i."id"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    docNo: String(h.docNo),
    reference: h.reference == null ? null : String(h.reference),
    vehiclePlate: h.vehiclePlate == null ? null : String(h.vehiclePlate),
    driverName: h.driverName == null ? null : String(h.driverName),
    status: String(h.status),
    createdAt: h.createdAt,
    dispatchedAt: h.dispatchedAt ?? null,
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.productId),
      productName: String(i.productName),
      batchNo: i.batchNo == null ? null : String(i.batchNo),
      locationId: String(i.locationId),
      locationCode: String(i.locationCode),
      quintals: num(i.quintals),
      bags: num(i.bags),
    })),
  };
}

export async function createDispatch(
  userId: string,
  b: {
    reference?: string | null;
    vehiclePlate?: string | null;
    driverName?: string | null;
    items: DispatchItemInput[];
  },
) {
  if (!b.items?.length) throw new AppError(400, 'At least one item is required');
  const id = uid();
  let docNo = '';
  await prisma.$transaction(async (tx) => {
    docNo = await nextDocNo(tx, 'WhDispatch', 'docNo', 'WH-DP-');
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhDispatch" ("id","docNo","reference","vehiclePlate","driverName","status","createdById")
       VALUES ($1,$2,$3,$4,$5,'DRAFT',$6)`,
      id, docNo, b.reference ?? null, b.vehiclePlate ?? null, b.driverName ?? null, userId,
    );
    for (const it of b.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhDispatchItem"
           ("id","dispatchId","productId","batchNo","locationId","quintals","bags")
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        uid(), id, it.productId, it.batchNo ?? null, it.locationId, it.quintals, it.bags ?? 0,
      );
      // Linked reservations are consumed at pick time; verify the link is valid now.
      if (it.reservationId) {
        const rsv = await tx.$queryRawUnsafe<Array<{ status: string }>>(
          `SELECT "status" FROM "WhReservation" WHERE "id" = $1`,
          it.reservationId,
        );
        if (!rsv[0] || rsv[0].status !== 'ACTIVE') {
          throw new AppError(400, 'Linked reservation is not ACTIVE');
        }
      }
    }
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhDispatch',
      entityId: id,
      changes: { docNo, lines: b.items.length },
    });
  });
  return getDispatch(id);
}

export async function transitionDispatch(
  userId: string,
  id: string,
  to: 'PICKED' | 'DISPATCHED' | 'CANCELLED',
  reservationIds?: string[],
) {
  await prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","docNo","status" FROM "WhDispatch" WHERE "id" = $1`,
      id,
    );
    if (!heads[0]) throw new AppError(404, 'Dispatch not found');
    const h = heads[0];
    const from = String(h.status);
    const ok =
      (to === 'PICKED' && from === 'DRAFT') ||
      (to === 'DISPATCHED' && from === 'PICKED') ||
      (to === 'CANCELLED' && (from === 'DRAFT' || from === 'PICKED'));
    if (!ok) throw new AppError(409, `Cannot move dispatch from ${from} to ${to}`);
    if (to === 'PICKED') {
      const items = await tx.$queryRawUnsafe<Array<RawNum>>(
        `SELECT "productId","batchNo","locationId","quintals"::float AS "quintals"
         FROM "WhDispatchItem" WHERE "dispatchId" = $1`,
        id,
      );
      for (const it of items) {
        await assertAvailable(tx, String(it.locationId), String(it.productId), it.batchNo == null ? null : String(it.batchNo), num(it.quintals));
      }
      for (const rid of reservationIds ?? []) {
        await tx.$executeRawUnsafe(
          `UPDATE "WhReservation" SET "status" = 'CONSUMED' WHERE "id" = $1 AND "status" = 'ACTIVE'`,
          rid,
        );
      }
      await tx.$executeRawUnsafe(`UPDATE "WhDispatch" SET "status" = 'PICKED' WHERE "id" = $1`, id);
    } else if (to === 'DISPATCHED') {
      const items = await tx.$queryRawUnsafe<Array<RawNum>>(
        `SELECT "productId","batchNo","locationId","quintals"::float AS "quintals","bags"
         FROM "WhDispatchItem" WHERE "dispatchId" = $1`,
        id,
      );
      for (const it of items) {
        const locId = String(it.locationId);
        const batchNo = it.batchNo == null ? null : String(it.batchNo);
        await assertAvailable(tx, locId, String(it.productId), batchNo, num(it.quintals));
        const avg = await weightedAvgCost(tx, locId, String(it.productId));
        await tx.$executeRawUnsafe(
          `INSERT INTO "WhStockLedger"
             ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr","movementType","reference","refId","createdById")
           VALUES ($1,$2,$3,$4,$5,$6,$7,'DISPATCH',$8,$9,$10)`,
          uid(), locId, String(it.productId), batchNo,
          -num(it.quintals), -num(it.bags), avg, String(h.docNo), id, userId,
        );
      }
      await tx.$executeRawUnsafe(
        `UPDATE "WhDispatch" SET "status" = 'DISPATCHED', "dispatchedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        id,
      );
    } else {
      await tx.$executeRawUnsafe(`UPDATE "WhDispatch" SET "status" = 'CANCELLED' WHERE "id" = $1`, id);
    }
    await audit(tx, {
      userId,
      action: to === 'DISPATCHED' ? 'POST' : 'UPDATE',
      entityType: 'WhDispatch',
      entityId: id,
      changes: { docNo: String(h.docNo), from, to },
    });
  });
  return getDispatch(id);
}

// ── 7. Physical stocktaking ──────────────────────────────────────────────────

export async function listCountSessions(status?: string) {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT s."id", s."sessionNo", s."scheduledDate", s."status", s."createdAt",
            l."code" AS "locationCode",
            COUNT(li."id") AS "lineCount",
            COUNT(li."countedQ") AS "countedLines",
            COALESCE(SUM(ABS(COALESCE(li."varianceQ",0))),0)::float AS "totalAbsVariance"
     FROM "WhCountSession" s
     JOIN "WhLocation" l ON l."id" = s."locationId"
     LEFT JOIN "WhCountLine" li ON li."sessionId" = s."id"
     ${status ? 'WHERE s."status" = $1::"WhCountStatus"' : ''}
     GROUP BY s."id", l."code"
     ORDER BY s."createdAt" DESC`,
    ...(status ? [status] : []),
  );
  return rows.map((r) => ({
    id: String(r.id),
    sessionNo: String(r.sessionNo),
    locationCode: String(r.locationCode),
    scheduledDate: r.scheduledDate,
    status: String(r.status),
    createdAt: r.createdAt,
    lineCount: num(r.lineCount),
    countedLines: num(r.countedLines),
    totalAbsVariance: num(r.totalAbsVariance),
  }));
}

export async function getCountSession(id: string) {
  const heads = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT s."id", s."sessionNo", s."scheduledDate", s."status", s."createdAt", s."postedAt",
            l."code" AS "locationCode", l."name" AS "locationName"
     FROM "WhCountSession" s
     JOIN "WhLocation" l ON l."id" = s."locationId"
     WHERE s."id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Count session not found');
  const lines = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT li."id", li."productId", pr."name" AS "productName", li."batchNo",
            li."systemQ"::float AS "systemQ", li."systemBags",
            li."countedQ"::float AS "countedQ", li."countedBags",
            li."recountQ"::float AS "recountQ", li."recountBags",
            li."varianceQ"::float AS "varianceQ"
     FROM "WhCountLine" li
     JOIN "Product" pr ON pr."id" = li."productId"
     WHERE li."sessionId" = $1 ORDER BY pr."name", li."batchNo" NULLS LAST`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    sessionNo: String(h.sessionNo),
    locationCode: String(h.locationCode),
    locationName: String(h.locationName),
    scheduledDate: h.scheduledDate,
    status: String(h.status),
    createdAt: h.createdAt,
    postedAt: h.postedAt ?? null,
    lines: lines.map((li) => ({
      id: String(li.id),
      productId: String(li.productId),
      productName: String(li.productName),
      batchNo: li.batchNo == null ? null : String(li.batchNo),
      systemQ: num(li.systemQ),
      systemBags: num(li.systemBags),
      countedQ: li.countedQ == null ? null : num(li.countedQ),
      countedBags: li.countedBags == null ? null : num(li.countedBags),
      recountQ: li.recountQ == null ? null : num(li.recountQ),
      recountBags: li.recountBags == null ? null : num(li.recountBags),
      varianceQ: li.varianceQ == null ? null : num(li.varianceQ),
    })),
  };
}

// Create a session and snapshot current system quantities as blind-count lines.
export async function createCountSession(
  userId: string,
  b: { locationId: string; scheduledDate: string },
) {
  return prisma.$transaction(async (tx) => {
    const sessionNo = await nextDocNo(tx, 'WhCountSession', 'sessionNo', 'WH-CT-');
    const id = uid();
    await tx.$executeRawUnsafe(
      `INSERT INTO "WhCountSession" ("id","sessionNo","locationId","scheduledDate","status","createdById")
       VALUES ($1,$2,$3,$4,'PLANNED',$5)`,
      id,
      sessionNo,
      b.locationId,
      b.scheduledDate,
      userId,
    );
    const on = await onHandMap(tx, b.locationId);
    for (const [k, v] of on) {
      const [, p, bn] = k.split('|');
      if (Math.abs(v.quintals) < 0.005 && Math.abs(v.bags) < 1) continue;
      await tx.$executeRawUnsafe(
        `INSERT INTO "WhCountLine"
           ("id","sessionId","productId","batchNo","systemQ","systemBags")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        uid(),
        id,
        p,
        bn === '' ? null : bn,
        v.quintals,
        v.bags,
      );
    }
    await audit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'WhCountSession',
      entityId: id,
      changes: { sessionNo, lines: on.size },
    });
    return getCountSessionTx(tx, id);
  });
}

async function getCountSessionTx(tx: Tx, id: string) {
  const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT s."id", s."sessionNo", s."scheduledDate", s."status", s."createdAt", s."postedAt",
            l."code" AS "locationCode", l."name" AS "locationName"
     FROM "WhCountSession" s
     JOIN "WhLocation" l ON l."id" = s."locationId"
     WHERE s."id" = $1`,
    id,
  );
  const lines = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT li."id", li."productId", pr."name" AS "productName", li."batchNo",
            li."systemQ"::float AS "systemQ", li."systemBags",
            li."countedQ"::float AS "countedQ", li."countedBags",
            li."recountQ"::float AS "recountQ", li."recountBags",
            li."varianceQ"::float AS "varianceQ"
     FROM "WhCountLine" li
     JOIN "Product" pr ON pr."id" = li."productId"
     WHERE li."sessionId" = $1 ORDER BY pr."name"`,
    id,
  );
  const h = heads[0];
  return {
    id: String(h.id),
    sessionNo: String(h.sessionNo),
    locationCode: String(h.locationCode),
    locationName: String(h.locationName),
    scheduledDate: h.scheduledDate,
    status: String(h.status),
    createdAt: h.createdAt,
    postedAt: h.postedAt ?? null,
    lines: lines.map((li) => ({
      id: String(li.id),
      productId: String(li.productId),
      productName: String(li.productName),
      batchNo: li.batchNo == null ? null : String(li.batchNo),
      systemQ: num(li.systemQ),
      systemBags: num(li.systemBags),
      countedQ: li.countedQ == null ? null : num(li.countedQ),
      countedBags: li.countedBags == null ? null : num(li.countedBags),
      recountQ: li.recountQ == null ? null : num(li.recountQ),
      recountBags: li.recountBags == null ? null : num(li.recountBags),
      varianceQ: li.varianceQ == null ? null : num(li.varianceQ),
    })),
  };
}

async function requireCountStatus(tx: Tx, id: string, allowed: string[]): Promise<RawNum> {
  const heads = await tx.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "id","sessionNo","status","locationId" FROM "WhCountSession" WHERE "id" = $1`,
    id,
  );
  if (!heads[0]) throw new AppError(404, 'Count session not found');
  if (!allowed.includes(String(heads[0].status))) {
    throw new AppError(409, `Session is ${heads[0].status}; expected ${allowed.join(' or ')}`);
  }
  return heads[0];
}

// Blind count entry: counters submit counted quantities; system quantities are
// intentionally not returned to the client in the counting UI.
export async function submitCounts(
  userId: string,
  id: string,
  lines: Array<{ lineId: string; countedQ: number; countedBags?: number }>,
) {
  await prisma.$transaction(async (tx) => {
    const head = await requireCountStatus(tx, id, ['PLANNED', 'IN_PROGRESS']);
    for (const ln of lines) {
      const found = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "WhCountLine" WHERE "id" = $1 AND "sessionId" = $2`,
        ln.lineId,
        id,
      );
      if (!found[0]) throw new AppError(400, 'Count line does not belong to this session');
      await tx.$executeRawUnsafe(
        `UPDATE "WhCountLine" SET "countedQ" = $1, "countedBags" = $2 WHERE "id" = $3`,
        ln.countedQ,
        ln.countedBags ?? 0,
        ln.lineId,
      );
    }
    await tx.$executeRawUnsafe(`UPDATE "WhCountSession" SET "status" = 'IN_PROGRESS' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'COUNT',
      entityType: 'WhCountSession',
      entityId: id,
      changes: { sessionNo: String(head.sessionNo), lines: lines.length },
    });
  });
  return getCountSession(id);
}

export async function requestRecount(userId: string, id: string, lineIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await requireCountStatus(tx, id, ['IN_PROGRESS']);
    if (!lineIds.length) throw new AppError(400, 'Select at least one line to recount');
    await tx.$executeRawUnsafe(
      `UPDATE "WhCountLine" SET "recountQ" = NULL, "recountBags" = NULL
       WHERE "sessionId" = $1 AND "id" = ANY($2::text[])`,
      id,
      lineIds,
    );
    await tx.$executeRawUnsafe(`UPDATE "WhCountSession" SET "status" = 'RECOUNT' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'UPDATE',
      entityType: 'WhCountSession',
      entityId: id,
      changes: { to: 'RECOUNT', lines: lineIds.length },
    });
  });
  return getCountSession(id);
}

export async function submitRecount(
  userId: string,
  id: string,
  lines: Array<{ lineId: string; recountQ: number; recountBags?: number }>,
) {
  await prisma.$transaction(async (tx) => {
    const head = await requireCountStatus(tx, id, ['RECOUNT']);
    for (const ln of lines) {
      const found = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "WhCountLine" WHERE "id" = $1 AND "sessionId" = $2`,
        ln.lineId,
        id,
      );
      if (!found[0]) throw new AppError(400, 'Count line does not belong to this session');
      await tx.$executeRawUnsafe(
        `UPDATE "WhCountLine" SET "recountQ" = $1, "recountBags" = $2 WHERE "id" = $3`,
        ln.recountQ,
        ln.recountBags ?? 0,
        ln.lineId,
      );
    }
    await tx.$executeRawUnsafe(`UPDATE "WhCountSession" SET "status" = 'IN_PROGRESS' WHERE "id" = $1`, id);
    await audit(tx, {
      userId,
      action: 'RECOUNT',
      entityType: 'WhCountSession',
      entityId: id,
      changes: { sessionNo: String(head.sessionNo), lines: lines.length },
    });
  });
  return getCountSession(id);
}

// Approve & post: variance (recount ?? counted − system) is posted as
// COUNT_IN / COUNT_OUT ledger corrections.
export async function approveCountSession(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const head = await requireCountStatus(tx, id, ['IN_PROGRESS']);
    const locationId = String(head.locationId);
    const lines = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT "id","productId","batchNo",
              "systemQ"::float AS "systemQ", "systemBags",
              "countedQ"::float AS "countedQ", "countedBags",
              "recountQ"::float AS "recountQ", "recountBags"
       FROM "WhCountLine" WHERE "sessionId" = $1`,
      id,
    );
    const uncounted = lines.filter((l) => l.countedQ == null);
    if (uncounted.length) throw new AppError(400, `${uncounted.length} line(s) have no counted quantity yet`);
    let posted = 0;
    for (const ln of lines) {
      const effectiveQ = ln.recountQ == null ? num(ln.countedQ) : num(ln.recountQ);
      const effectiveBags = ln.recountQ == null ? num(ln.countedBags) : num(ln.recountBags);
      const varianceQ = Math.round((effectiveQ - num(ln.systemQ)) * 100) / 100;
      const varianceBags = Math.round(effectiveBags - num(ln.systemBags));
      await tx.$executeRawUnsafe(
        `UPDATE "WhCountLine" SET "varianceQ" = $1 WHERE "id" = $2`,
        varianceQ,
        String(ln.id),
      );
      if (Math.abs(varianceQ) >= 0.005 || varianceBags !== 0) {
        if (varianceQ < 0) {
          await assertAvailable(tx, locationId, String(ln.productId), ln.batchNo == null ? null : String(ln.batchNo), -varianceQ);
        }
        const avg = await weightedAvgCost(tx, locationId, String(ln.productId));
        await tx.$executeRawUnsafe(
          `INSERT INTO "WhStockLedger"
             ("id","locationId","productId","batchNo","quintals","bags","unitCostBirr","movementType","reference","refId","createdById")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          uid(), locationId, String(ln.productId),
          ln.batchNo == null ? null : String(ln.batchNo),
          varianceQ, varianceBags, avg,
          varianceQ > 0 ? 'COUNT_IN' : 'COUNT_OUT',
          String(head.sessionNo), id, userId,
        );
        posted++;
      }
    }
    await tx.$executeRawUnsafe(
      `UPDATE "WhCountSession" SET "status" = 'POSTED', "approvedById" = $2, "postedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      id,
      userId,
    );
    await audit(tx, {
      userId,
      action: 'APPROVE',
      entityType: 'WhCountSession',
      entityId: id,
      changes: { sessionNo: String(head.sessionNo), correctionsPosted: posted },
    });
  });
  return getCountSession(id);
}

// ── 8. Valuation & reports ───────────────────────────────────────────────────

export interface ValuationRow {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  bags: number;
  avgCostBirr: number;
  valueBirr: number;
}

export async function valuation(locationId?: string): Promise<ValuationRow[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<RawNum>>(
      `SELECT l."id" AS "locationId", l."code" AS "locationCode", l."name" AS "locationName",
              p."id" AS "productId", p."name" AS "productName",
              g."batchNo",
              SUM(g."quintals")::float AS "q", SUM(g."bags") AS "b",
              (SUM(CASE WHEN g."quintals" > 0 AND g."unitCostBirr" IS NOT NULL
                       THEN g."quintals" * g."unitCostBirr" ELSE 0 END))::float AS "costIn",
              (SUM(CASE WHEN g."quintals" > 0 AND g."unitCostBirr" IS NOT NULL
                       THEN g."quintals" ELSE 0 END))::float AS "qIn"
       FROM (SELECT "locationId","productId",COALESCE("batchNo",'') AS "batchNo",
                    "quintals","bags","unitCostBirr" FROM "WhStockLedger") g
       JOIN "WhLocation" l ON l."id" = g."locationId"
       JOIN "Product" p ON p."id" = g."productId"
       ${locationId ? 'WHERE g."locationId" = $1' : ''}
       GROUP BY l."id", l."code", l."name", p."id", p."name", g."batchNo"
       HAVING ABS(SUM(g."quintals")) >= 0.005
       ORDER BY l."code", p."name"`,
      ...(locationId ? [locationId] : []),
    );
    return rows.map((r) => {
      const q = num(r.q);
      const qIn = num(r.qIn);
      const avg = qIn > 0 ? num(r.costIn) / qIn : 0;
      return {
        locationId: String(r.locationId),
        locationCode: String(r.locationCode),
        locationName: String(r.locationName),
        productId: String(r.productId),
        productName: String(r.productName),
        batchNo: String(r.batchNo) === '' ? null : String(r.batchNo),
        quintals: Math.round(q * 100) / 100,
        bags: num(r.b),
        avgCostBirr: Math.round(avg * 100) / 100,
        valueBirr: Math.round(q * avg * 100) / 100,
      };
    });
  });
}

export interface MovementSummaryRow {
  movementType: WhMovementType;
  lines: number;
  inQ: number;
  outQ: number;
}

export async function movementsSummary(opts: {
  from?: string;
  to?: string;
  locationId?: string;
}): Promise<MovementSummaryRow[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.from) {
    vals.push(opts.from);
    conds.push(`"movedAt" >= $${vals.length}::timestamptz`);
  }
  if (opts.to) {
    vals.push(opts.to);
    conds.push(`"movedAt" <= $${vals.length}::timestamptz`);
  }
  if (opts.locationId) {
    vals.push(opts.locationId);
    conds.push(`"locationId" = $${vals.length}`);
  }
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `SELECT "movementType",
            COUNT(*) AS "lines",
            COALESCE(SUM(CASE WHEN "quintals" > 0 THEN "quintals" ELSE 0 END),0)::float AS "inQ",
            COALESCE(SUM(CASE WHEN "quintals" < 0 THEN -"quintals" ELSE 0 END),0)::float AS "outQ"
     FROM "WhStockLedger"
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     GROUP BY "movementType" ORDER BY "movementType"`,
    ...vals,
  );
  return rows.map((r) => ({
    movementType: r.movementType as WhMovementType,
    lines: num(r.lines),
    inQ: num(r.inQ),
    outQ: num(r.outQ),
  }));
}

export interface AgingRow {
  locationCode: string;
  productName: string;
  batchNo: string | null;
  quintals: number;
  daysOld: number;
  bucket: '0-30d' | '31-60d' | '61-90d' | '90d+';
}

// Age of stock = days since the earliest ledger receipt for that
// location + product (+ batch).
export async function stockAging(locationId?: string): Promise<AgingRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<RawNum>>(
    `WITH g AS (
       SELECT "locationId","productId",COALESCE("batchNo",'') AS "batchNo",
              SUM("quintals")::float AS "q", MIN("movedAt") AS "firstAt"
       FROM "WhStockLedger"
       ${locationId ? 'WHERE "locationId" = $1' : ''}
       GROUP BY "locationId","productId",COALESCE("batchNo",'')
     )
     SELECT l."code" AS "locationCode", p."name" AS "productName", g."batchNo",
            g."q" AS "quintals",
            EXTRACT(DAY FROM (CURRENT_TIMESTAMP - g."firstAt"))::int AS "daysOld"
     FROM g
     JOIN "WhLocation" l ON l."id" = g."locationId"
     JOIN "Product" p ON p."id" = g."productId"
     WHERE ABS(g."q") >= 0.005
     ORDER BY "daysOld" DESC`,
    ...(locationId ? [locationId] : []),
  );
  return rows.map((r) => {
    const d = num(r.daysOld);
    const bucket: AgingRow['bucket'] = d <= 30 ? '0-30d' : d <= 60 ? '31-60d' : d <= 90 ? '61-90d' : '90d+';
    return {
      locationCode: String(r.locationCode),
      productName: String(r.productName),
      batchNo: String(r.batchNo) === '' ? null : String(r.batchNo),
      quintals: Math.round(num(r.quintals) * 100) / 100,
      daysOld: d,
      bucket,
    };
  });
}
