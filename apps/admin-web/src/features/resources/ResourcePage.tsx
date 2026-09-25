import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { Section } from '@/app/config/sections';
import { DataTable } from '@/shared/ui/DataTable';
import { DetailPanel, ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { actions } from '@/app/config/actions';
import { ActionDialog } from '@/shared/ui/ActionDialog';
import { useAuth } from '@/features/auth/auth-context';
import { groupRows, type Row } from '@/shared/refine/resource-shape';

/**
 * Legacy path, kept only for `flags` and `capabilities` (Refine install
 * plan, Phase 3): their real API response genuinely returns more than one
 * row group at once — flag definitions + targeting rules; capability
 * definitions + store overrides (confirmed against
 * admin-control-plane.ts). Refine's `getList` is one resource → one flat
 * array, so these two aren't a single Refine resource and stay on the
 * original raw-fetch, multi-group rendering until someone deliberately
 * redesigns them into separate resources. Every other formerly-generic
 * section is on `RefineResourcePage` now.
 */
export function ResourcePage({ section }: { section: Section }) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const auth = useAuth();
  const action = actions[section.id];
  const query = useQuery({ queryKey: ['resource', section.id], queryFn: () => api<Row>(section.endpoint!) });
  const groups = groupRows(query.data, section.resultKeys || []);
  return <>
    <PageHeader title={section.label} description={section.description} actions={<>{action && auth.can(action.permission) && <button className="button primary" onClick={() => setActionOpen(true)}><Plus size={16} /> {action.label}</button>}<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button></>} />
    {query.isLoading && <LoadingState />}
    {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
    {groups.map(group => <section className="resource-group" key={group.key}>{groups.length > 1 && <div className="section-heading"><h2>{group.label}</h2><span>{group.rows.length}</span></div>}<DataTable rows={group.rows} onSelect={setSelected} preferred={preferredColumns[section.id] || []} /></section>)}
    {selected && <DetailPanel title={String(selected.name ?? selected.store_name ?? selected.subject ?? selected.id ?? section.label)} row={selected} onClose={() => setSelected(null)} />}
    {actionOpen && action && <ActionDialog config={action} resourceKey={section.id} close={() => setActionOpen(false)} />}
  </>;
}

const preferredColumns: Record<string, string[]> = {
  flags: ['flag_key', 'description', 'status', 'env_gate', 'runtime_consumer', 'risk'],
  capabilities: ['domain', 'label', 'implementation_status', 'risk', 'runtime_consumer', 'enforcement_binding'],
};
