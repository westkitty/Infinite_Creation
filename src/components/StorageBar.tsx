import { useEffect, useState } from 'react';
import { requestPersistence, storageUsage } from '../assets/db';
import { formatBytes } from '../lib/ids';
import { useExecStore } from '../stores/execStore';

export function StorageBar() {
  const [usage, setUsage] = useState<{ used?: number; quota?: number }>({});
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const log = useExecStore((s) => s.log);

  useEffect(() => {
    storageUsage().then(setUsage).catch(() => {});
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any)?.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    } catch { setPersisted(null); }
  }, []);

  const pct = usage.used !== undefined && usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : null;

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <strong>Local storage</strong>
        <span style={{ color: 'var(--text-2)' }}>
          {usage.used !== undefined ? formatBytes(usage.used) : '—'} used
          {usage.quota ? ` of ${formatBytes(usage.quota)}` : ''}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" title="Ask the browser to persist site storage (no guarantee of retention)"
          onClick={() => { void requestPersistence().then((ok) => { setPersisted(ok); log(ok ? 'Persistent storage granted.' : 'Persistent storage not granted — the browser may evict data under pressure.'); }); }}>
          {persisted ? 'Persisted ✓' : 'Request persistence'}
        </button>
        <button className="btn" onClick={() => storageUsage().then(setUsage).catch(() => {})}>Refresh</button>
      </div>
      {pct !== null && <div className="progressbar" style={{ marginTop: 6 }}><div style={{ width: `${pct}%` }} /></div>}
      <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '6px 0 0' }}>
        Projects and asset binaries live in IndexedDB on this device only. Browsers may evict storage under pressure — use File ▸ Export workflow JSON and project archives (Phase 7) for backups.
      </p>
    </div>
  );
}
