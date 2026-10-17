import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { E } from '../lib/endpoints';
import { Badge } from '../components/Badge';
import { DataTable } from '../components/DataTable';
import { Button, Card, SectionTitle, Spinner } from '../components/ui';

interface ModuleToggle {
  id: string;
  moduleKey: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

export function ModuleManager() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['module-toggles'],
    queryFn: async () => (await api.get<ModuleToggle[]>(E.moduleToggles)).data,
  });

  const toggle = async (m: ModuleToggle) => {
    setToggling(m.id);
    setNotice(null);
    try {
      await api.patch(E.moduleToggle(m.id), { enabled: !m.enabled });
      setNotice({ ok: true, text: `${m.name} ${!m.enabled ? 'enabled' : 'disabled'}.` });
      qc.invalidateQueries({ queryKey: ['module-toggles'] });
    } catch {
      setNotice({ ok: false, text: 'Failed to update module status.' });
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Module Manager"
        sub="Enable or disable ERP modules. Disabled modules are hidden from navigation. All changes are audit-logged."
      />

      {notice && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${notice.ok ? 'bg-pass-bg text-pass-text' : 'bg-critical-bg text-critical-text'}`}>
          {notice.text}
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable<ModuleToggle>
            columns={[
              { key: 'name', label: 'Module', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'description', label: 'Description', render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.description ?? '—'}</span> },
              {
                key: 'enabled', label: 'Status',
                render: (r) => <Badge tone={r.enabled ? 'pass' : 'neutral'}>{r.enabled ? 'Enabled' : 'Disabled'}</Badge>,
              },
              {
                key: 'id', label: '',
                render: (r) => (
                  <Button
                    variant={r.enabled ? 'secondary' : 'primary'}
                    disabled={toggling === r.id}
                    onClick={() => toggle(r)}
                  >
                    {toggling === r.id ? '…' : r.enabled ? 'Disable' : 'Enable'}
                  </Button>
                ),
              },
            ]}
            rows={data ?? []}
            emptyTitle="No modules configured."
          />
        )}
      </Card>
    </div>
  );
}
