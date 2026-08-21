import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { Section } from '@/app/config/sections';
import { DataTable } from '@/shared/ui/DataTable';
import { DetailPanel, ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { actions } from '@/app/config/actions';
import { ActionDialog } from '@/shared/ui/ActionDialog';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;

export function ResourcePage({ section }: { section: Section }) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const auth = useAuth();
  const action = actions[section.id];
  const query = useQuery({ queryKey: ['resource', section.id], queryFn: () => api<Record<string, unknown>>(section.endpoint!) });
  const groups = rowsFromPayload(query.data, section.resultKeys || []);
  return <>
    <PageHeader title={section.label} description={section.description} actions={<>{action && auth.can(action.permission) && <button className="button primary" onClick={() => setActionOpen(true)}><Plus size={16} /> {action.label}</button>}<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button></>} />
    {query.isLoading && <LoadingState />}
    {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
    {section.id === 'subscriptions' && <BillingLeaseHealth />}
    {groups.map(group => <section className="resource-group" key={group.key}>{groups.length > 1 && <div className="section-heading"><h2>{group.label}</h2><span>{group.rows.length}</span></div>}<DataTable rows={group.rows} onSelect={setSelected} preferred={preferredColumns[section.id] || []} /></section>)}
    {selected && <DetailPanel title={String(selected.name ?? selected.store_name ?? selected.subject ?? selected.id ?? section.label)} row={selected} onClose={() => setSelected(null)} actions={section.id === 'exports' ? <ExportDownload row={selected} /> : section.id === 'privacy' ? <PrivacyActions row={selected} close={() => setSelected(null)} /> : section.id === 'translations' ? <TranslationActions row={selected} close={() => setSelected(null)} /> : section.id === 'content' ? <ContentActions row={selected} close={() => setSelected(null)} /> : undefined} />}
    {actionOpen && action && <ActionDialog config={action} resourceKey={section.id} close={() => setActionOpen(false)} />}
  </>;
}

type BillingHealth = {
  claim_leases?: {
    lease_seconds?: number;
    durations?: { samples?: number; average_ms?: number; maximum_ms?: number; p50_ms?: number; p95_ms?: number; exceeded_lease?: number };
    reclaims?: { total_reclaims?: number; jobs_reclaimed?: number; last_reclaimed_at?: string | null };
  };
};

function BillingLeaseHealth() {
  const query = useQuery({
    queryKey: ['billing-health'],
    queryFn: () => api<BillingHealth>('/api/admin/v1/billing/health'),
    refetchInterval: 60_000,
  });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const lease = Number(query.data?.claim_leases?.lease_seconds ?? 120);
  const durations = query.data?.claim_leases?.durations ?? {};
  const reclaims = query.data?.claim_leases?.reclaims ?? {};
  const p95 = Number(durations.p95_ms ?? 0);
  const review = p95 >= lease * 1000 * 0.8 || Number(durations.exceeded_lease ?? 0) > 0;
  const seconds = (value: unknown) => `${(Number(value ?? 0) / 1000).toFixed(1)} s`;
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">PLAY CLAIM LEASE</p><h2>Verification duration and reclaim health</h2><p>Lease changes require observed percentile evidence. A reclaim can duplicate a non-charging Google verification or acknowledgement call.</p></div><span className={review ? 'status danger' : 'status active'}>{review ? 'Review lease' : 'Within lease'}</span></div>
    <dl className="snapshot">
      <div><dt>Lease</dt><dd>{lease} s</dd></div>
      <div><dt>p50</dt><dd>{seconds(durations.p50_ms)}</dd></div>
      <div><dt>p95</dt><dd>{seconds(durations.p95_ms)}</dd></div>
      <div><dt>Maximum</dt><dd>{seconds(durations.maximum_ms)}</dd></div>
      <div><dt>Samples</dt><dd>{Number(durations.samples ?? 0)}</dd></div>
      <div><dt>Over lease</dt><dd>{Number(durations.exceeded_lease ?? 0)}</dd></div>
      <div><dt>Total reclaims</dt><dd>{Number(reclaims.total_reclaims ?? 0)}</dd></div>
      <div><dt>Jobs reclaimed</dt><dd>{Number(reclaims.jobs_reclaimed ?? 0)}</dd></div>
    </dl>
    {reclaims.last_reclaimed_at && <p className="muted">Last reclaim: {String(reclaims.last_reclaimed_at)}</p>}
  </section>;
}

function TranslationActions({ row, close }: { row: Row; close: () => void }) {
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: (status: 'reviewed' | 'rejected') => api(`/api/admin/v1/product-translations/${encodeURIComponent(String(row.product_code))}/${encodeURIComponent(String(row.lang))}`, { method: 'PATCH', body: JSON.stringify({ status }) }), onSuccess: () => { client.invalidateQueries({ queryKey: ['resource', 'translations'] }); close(); } });
  return <><p className="muted">Rejected or stale content falls back to seller-authored source text at runtime.</p><div className="button-row"><button className="button primary" disabled={mutation.isPending} onClick={() => mutation.mutate('reviewed')}>Approve current translation</button><button className="button danger" disabled={mutation.isPending} onClick={() => { if (confirm('Reject this translation and use seller-authored fallback?')) mutation.mutate('rejected'); }}>Reject and fall back</button></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}</>;
}

function ContentActions({ row, close }: { row: Row; close: () => void }) {
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: () => api(`/api/admin/v1/content-configs/${encodeURIComponent(String(row.id))}/publish`, { method: 'POST', body: '{}' }), onSuccess: () => { client.invalidateQueries({ queryKey: ['resource', 'content'] }); close(); } });
  if (row.status !== 'draft') return <p className="muted">Published content remains immutable; create a new version to change it.</p>;
  return <><p className="muted">Publishing retires the previous version for the same content key and locale.</p><button className="button primary" disabled={mutation.isPending} onClick={() => { if (confirm('Publish this content version?')) mutation.mutate(); }}>Publish version</button>{mutation.error && <p className="error-text">{mutation.error.message}</p>}</>;
}

function PrivacyActions({ row, close }: { row: Row; close: () => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [phone, setPhone] = useState('');
  const [correctedName, setCorrectedName] = useState('');
  const [notes, setNotes] = useState('');
  const current = String(row.status);
  const next = current === 'open' ? ['verified', 'rejected'] : current === 'verified' ? ['in_progress', 'rejected'] : current === 'in_progress' ? ['completed', 'rejected'] : [];
  const needsIdentity = target === 'completed' && ['deletion', 'correction'].includes(String(row.request_type));
  const mutation = useMutation({ mutationFn: () => api(`/api/admin/v1/buyer-privacy/${encodeURIComponent(String(row.id))}`, { method: 'PATCH', body: JSON.stringify({ status: target, buyer_phone: phone || undefined, corrected_name: correctedName || undefined, notes }) }), onSuccess: () => { client.invalidateQueries({ queryKey: ['resource', 'privacy'] }); setOpen(false); close(); } });
  if (!next.length) return <p className="muted">This request has reached a terminal state.</p>;
  return <><div className="button-row">{next.map(status => <button className={`button ${status === 'rejected' ? 'danger' : 'primary'}`} key={status} onClick={() => { setTarget(status); setOpen(true); }}>{status.replace('_', ' ')}</button>)}</div>{open && <div className="modal-backdrop"><section className="modal compact" role="dialog" aria-modal="true"><header><div><p className="eyebrow">PRIVACY WORKFLOW</p><h2>Move request to {target.replace('_', ' ')}</h2><p>Every transition is recorded in the immutable admin audit trail.</p></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button></header><div className="form-grid">{needsIdentity && <label className="field"><span>Re-enter customer phone *</span><input value={phone} onChange={event => setPhone(event.target.value)} /></label>}{needsIdentity && row.request_type === 'correction' && <label className="field"><span>Corrected customer name *</span><input value={correctedName} onChange={event => setCorrectedName(event.target.value)} /></label>}<label className="field wide"><span>Evidence / resolution note</span><textarea rows={4} value={notes} onChange={event => setNotes(event.target.value)} /></label></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}<footer><button className="button" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={mutation.isPending || (needsIdentity && phone.replace(/\D/g, '').length < 7) || (needsIdentity && row.request_type === 'correction' && !correctedName.trim())} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Applying…' : 'Confirm transition'}</button></footer></section></div>}</>;
}

function ExportDownload({ row }: { row: Row }) {
  const [freshOpen, setFreshOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const completed = row.status === 'completed' && !row.downloaded_at;
  const sensitive = row.classification === 'sensitive';
  const mutation = useMutation({ mutationFn: async () => {
    const headers = new Headers();
    if (sensitive) {
      const authorization = await api<{ authorization_id: string }>('/api/admin/v1/action-authorizations', { method: 'POST', body: JSON.stringify({ action: 'export.sensitive', entity_id: String(row.export_type), payload_hash: 'export-download', password, totp_code: totpCode }) });
      headers.set('x-admin-action-authorization', authorization.authorization_id);
    }
    const result = await api<{ download_url: string }>(`/api/admin/v1/exports/${encodeURIComponent(String(row.id))}/download`, { method: 'POST', headers, body: JSON.stringify({ acknowledgement: 'admin_ui_download' }) });
    window.location.assign(result.download_url);
  }, onSuccess: () => setFreshOpen(false) });
  if (!completed) return <p className="muted">Download becomes available once this private artifact completes. Tokens are one-use and expire in five minutes.</p>;
  return <><button className="button primary" onClick={() => sensitive ? setFreshOpen(true) : mutation.mutate()} disabled={mutation.isPending}><Download size={16} /> Download once</button>{mutation.error && <p className="error-text">{mutation.error.message}</p>}{freshOpen && <div className="modal-backdrop"><section className="modal compact" role="dialog" aria-modal="true" aria-label="Authorize sensitive export"><header><div><p className="eyebrow">FRESH OWNER AUTH</p><h2>Authorize sensitive download</h2><p>Password and a current TOTP are required. This authorization is bound to this export type and consumed once.</p></div><button className="icon-button" onClick={() => setFreshOpen(false)} aria-label="Close"><X size={18} /></button></header><div className="form-grid"><label className="field"><span>Owner password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label className="field"><span>Current TOTP</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}<footer><button className="button" onClick={() => setFreshOpen(false)}>Cancel</button><button className="button primary" disabled={password.length < 12 || totpCode.length !== 6 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Authorizing…' : 'Authorize and download'}</button></footer></section></div>}</>;
}

function rowsFromPayload(payload: Record<string, unknown> | undefined, keys: string[]) {
  if (!payload) return [];
  const groups = keys.flatMap(key => {
    const value = payload[key];
    if (Array.isArray(value)) return [{ key, label: key.replaceAll('_', ' '), rows: value as Row[] }];
    if (value && typeof value === 'object') return [{ key, label: key.replaceAll('_', ' '), rows: Object.entries(value as Record<string, unknown>).map(([name, item]) => ({ name, ...(typeof item === 'object' && item ? item as Row : { value: item }) })) }];
    return [];
  });
  if (groups.length) return groups;
  const arrays = Object.entries(payload).filter(([, value]) => Array.isArray(value));
  if (arrays.length) return arrays.map(([key, value]) => ({ key, label: key, rows: value as Row[] }));
  return [{ key: 'data', label: 'Data', rows: Object.entries(payload).map(([name, value]) => ({ name, value })) }];
}

const preferredColumns: Record<string, string[]> = {
  stores: ['store_name', 'store_code', 'country_code', 'status', 'product_count', 'category_count', 'created_at'],
  buyers: ['buyer_name', 'buyer_phone', 'store_name', 'order_count', 'total_minor', 'last_order_at', 'restricted'],
  support: ['id', 'subject', 'store_name', 'status', 'priority', 'assigned_email', 'updated_at'],
  deletions: ['id', 'phone_e164', 'status', 'requested_at', 'scheduled_for', 'verified_at'],
  subscriptions: ['store_name', 'plan_id', 'status', 'gateway', 'organization_status', 'current_period_end'],
  flags: ['flag_key', 'description', 'status', 'env_gate', 'runtime_consumer', 'risk'],
  versions: ['platform', 'country_code', 'minimum_version_code', 'recommended_version_code', 'maintenance_mode', 'active', 'updated_at'],
  capabilities: ['domain', 'label', 'implementation_status', 'risk', 'runtime_consumer', 'enforcement_binding'],
  audit: ['id', 'admin_email', 'action', 'entity', 'entity_id', 'ip', 'created_at'],
};
