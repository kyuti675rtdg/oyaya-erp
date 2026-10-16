import { useNetwork } from '../store/network';
import { fmtDateTime } from '../lib/format';

/** Full-width banner: offline mode with queued mutation count, or syncing state. */
export function OfflineBanner() {
  const { online, queued, syncing, lastSync } = useNetwork();

  if (online && queued === 0) return null;

  return (
    <div
      role="status"
      className={`no-print sticky top-0 z-40 border-b px-4 py-2.5 text-center text-sm font-semibold ${
        online
          ? 'border-advisory-text/30 bg-advisory-bg text-advisory-text'
          : 'border-critical-text/40 bg-critical-bg text-critical-text'
      }`}
    >
      {online ? (
        <>
          {syncing ? 'Syncing queued records...' : `Back online — ${queued} record${queued === 1 ? '' : 's'} queued for sync`}
          {lastSync ? <span className="tnum ml-2 font-normal">Last sync {fmtDateTime(lastSync)}</span> : null}
        </>
      ) : (
        <>OFFLINE MODE — {queued} record{queued === 1 ? '' : 's'} queued. Entries will sync automatically.</>
      )}
    </div>
  );
}
