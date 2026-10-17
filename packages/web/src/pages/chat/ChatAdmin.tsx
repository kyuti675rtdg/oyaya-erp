// Chat Admin — sync department channels and manage team chat.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Hash } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Button, EmptyState, SectionTitle } from '../../components/ui';
import { CardHeader } from '../../components/CardHeader';

const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)] dark:bg-slate-900 dark:border-slate-800';

export function ChatAdmin() {
  const qc = useQueryClient();
  const { hasClaim } = useAuth();
  const canManage = hasClaim('chat:manage');

  const syncMutation = useMutation({
    mutationFn: async () => (await api.post('/teamchat/sync')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teamchat-channels'] }),
  });

  if (!canManage) {
    return (
      <div className="p-6">
        <EmptyState title="No permission" sub="You need chat management permission to view this page." />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <SectionTitle title="Team Chat Administration" sub="Department channels, announcements, and direct messaging" />

      <div className={cardShell}>
        <CardHeader icon={<Hash className="h-5 w-5" />} title="Department Channels" />
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          Channels are created automatically from your departments. Members are synced from employees
          linked to each department. The <strong>Announcements</strong> channel is company-wide —
          only managers and admins can post there.
        </p>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          Files shared in chat are automatically saved to <strong>Document Management</strong> under
          the "Team Chat" category.
        </p>
        <Button className="mt-4" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {syncMutation.isPending ? 'Syncing…' : 'Sync Departments & Members'}
        </Button>
        {syncMutation.data && (
          <div className="mt-2">
            <p className="text-sm text-green-700 dark:text-green-400">
              Done — {syncMutation.data.created} channels created, {syncMutation.data.synced} memberships synced.
            </p>
            {syncMutation.data.errors?.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10" role="alert">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {syncMutation.data.errors.length} item(s) had issues:
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
                  {syncMutation.data.errors.slice(0, 10).map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {syncMutation.isError && (
          <p className="mt-2 text-sm text-red-600">
            {(syncMutation.error as any)?.response?.data?.error || 'Sync failed.'}
          </p>
        )}
      </div>
    </div>
  );
}
