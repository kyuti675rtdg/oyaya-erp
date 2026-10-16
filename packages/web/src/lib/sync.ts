import { api, isNetworkError } from './api';
import { db, type OutboxEntry } from './db';
import { uuidv7 } from './uuid';
import { useNetwork } from '../store/network';

export function getDeviceId(): string {
  let id = localStorage.getItem('oyaya-device-id');
  if (!id) {
    id = uuidv7();
    localStorage.setItem('oyaya-device-id', id);
  }
  return id;
}

export async function refreshQueuedCount(): Promise<void> {
  try {
    const n = await db.outbox.count();
    useNetwork.getState().setQueued(n);
  } catch {
    // Dexie unavailable (private mode etc.) — keep banner count at 0.
  }
}

export async function queueMutation(
  entity: string,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const clientUuid = uuidv7();
  const entry: OutboxEntry = {
    clientUuid,
    entity,
    url,
    data: { ...data, clientUuid },
    ts: Date.now(),
    deviceId: getDeviceId(),
    attempts: 0
  };
  await db.outbox.add(entry);
  await refreshQueuedCount();
  return clientUuid;
}

export interface SubmitResult<T> {
  queued: boolean;
  data?: T;
  clientUuid?: string;
}

/**
 * Try to send immediately when online (POST or PUT); on network failure (or
 * when offline) persist the mutation to the Dexie outbox with a UUIDv7
 * idempotency key. HTTP 4xx/5xx responses are rethrown — only connectivity
 * problems are queued.
 */
export async function submitOrQueue<T = unknown>(
  entity: string,
  url: string,
  data: Record<string, unknown>,
  method: 'post' | 'put' = 'post'
): Promise<SubmitResult<T>> {
  if (navigator.onLine) {
    try {
      const payload = { ...data, clientUuid: uuidv7() };
      const res =
        method === 'put' ? await api.put<T>(url, payload) : await api.post<T>(url, payload);
      return { queued: false, data: res.data };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  const clientUuid = await queueMutation(entity, url, data);
  return { queued: true, clientUuid };
}

interface SyncBatchResponse {
  accepted: string[];
}

/**
 * Push queued mutations to POST /api/v1/sync/batch in chronological order.
 * The server commits topologically and returns accepted clientUuids, which are
 * then removed from the outbox. Unaccepted entries stay queued for retry.
 */
export async function syncOutbox(): Promise<void> {
  const net = useNetwork.getState();
  if (!navigator.onLine || net.syncing) return;

  const entries = await db.outbox.orderBy('ts').toArray();
  if (entries.length === 0) {
    net.setLastSync(Date.now());
    return;
  }

  net.setSyncing(true);
  try {
    const res = await api.post<SyncBatchResponse>('/sync/batch', {
      deviceId: getDeviceId(),
      mutations: entries.map((e) => ({
        clientUuid: e.clientUuid,
        entity: e.entity,
        url: e.url,
        data: e.data,
        ts: e.ts
      }))
    });
    const accepted = new Set(res.data.accepted ?? []);
    if (accepted.size > 0) {
      await db.outbox.where('clientUuid').anyOf(Array.from(accepted)).delete();
    }
  } catch {
    // Connectivity or server error — keep everything queued for the next attempt.
  } finally {
    useNetwork.getState().setSyncing(false);
    await refreshQueuedCount();
    useNetwork.getState().setLastSync(Date.now());
  }
}
