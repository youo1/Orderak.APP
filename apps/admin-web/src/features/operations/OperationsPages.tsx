import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Play, RefreshCw, RotateCcw, ShieldAlert, Smartphone, UserPlus } from 'lucide-react';
import { api } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;

export function DeletionsPage() {
  const [selected, setSelected] = useState<Row | null>(null);
  const [notes, setNotes] = useState('');
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['deletions'], queryFn: () => api<{ requests: Row[] }>('/api/admin/v1/deletion-requests') });
  const action = useMutation({ mutationFn: ({ id, kind }: { id: string; kind: 'verify' | 'retry' }) => api(`/api/admin/v1/deletion-requests/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ notes }) }), onSuccess: () => { setSelected(null); setNotes(''); client.invalidateQueries({ queryKey: ['deletions'] }); } });
  return <><PageHeader title="Deletion & Trust" description="Identity verification, deadline enforcement and safe fulfillment retries." actions={<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button>} />
    <section className="truth-banner warning"><AlertTriangle /><div><strong>Deletion retries never bypass verification or deadline</strong><p>The backend enforces eligible state and due time even for owner-triggered retries.</p></div></section>
    {query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <DataTable rows={query.data.requests} onSelect={setSelected} preferred={['id', 'phone_e164', 'status', 'requested_at', 'scheduled_for', 'verified_at', 'attempt_count']} />}
    {selected && <div className="modal-backdrop"><section className="modal"><header><div><p className="eyebrow">DELETION REQUEST</p><h2>{String(selected.id)}</h2><StatusBadge value={selected.status} /></div><button className="icon-button" onClick={() => setSelected(null)}>×</button></header><pre className="json-view">{JSON.stringify(selected, null, 2)}</pre>{selected.status === 'pending' && <label className="field"><span>Identity evidence notes</span><textarea rows={4} value={notes} onChange={event => setNotes(event.target.value)} /></label>}<footer><button className="button" onClick={() => setSelected(null)}>Close</button>{selected.status === 'pending' && <button className="button primary" disabled={notes.trim().length < 5 || action.isPending} onClick={() => action.mutate({ id: String(selected.id), kind: 'verify' })}><CheckCircle2 size={16} /> Verify</button>}<button className="button danger" disabled={action.isPending} onClick={() => { if (confirm('Retry this request? Server-side deadline and verification checks remain enforced.')) action.mutate({ id: String(selected.id), kind: 'retry' }); }}><RotateCcw size={16} /> Safe retry</button></footer>{action.error && <p className="error-text">{action.error.message}</p>}</section></div>}
  </>;
}

export function JobsPage() {
  const client = useQueryClient();
  const auth = useAuth();
  const query = useQuery({ queryKey: ['jobs'], queryFn: () => api<{ runs: Row[] }>('/api/admin/v1/operations/jobs') });
  const run = useMutation({ mutationFn: (job: string) => api(`/api/admin/v1/operations/jobs/${job}/run`, { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }) });
  return <><PageHeader title="Operational jobs" description="Last result, affected counts and audited owner-only retries." />{auth.can('operations:run') && <div className="job-actions">{['retention', 'deletions', 'google-play'].map(job => <button className="button" key={job} disabled={run.isPending} onClick={() => { if (confirm(`Run ${job} now?`)) run.mutate(job); }}><Play size={15} /> Run {job}</button>)}</div>}{run.error && <p className="error-text">{run.error.message}</p>}{query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <DataTable rows={query.data.runs} preferred={['job_key', 'trigger_kind', 'status', 'started_at', 'completed_at', 'affected_count', 'error_message']} />}</>;
}

export function SecurityPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Row | null>(null);
  const query = useQuery({ queryKey: ['security'], queryFn: async () => {
    const [security, sessions] = await Promise.all([api<Record<string, unknown>>('/api/admin/v1/security'), api<{ items: Row[]; current_session_id: string }>('/api/admin/v1/access/sessions')]);
    return { security, sessions };
  } });
  const alertMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/admin/v1/security/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ status, resolution_note: 'Reviewed in security workspace' }) }), onSuccess: () => client.invalidateQueries({ queryKey: ['security'] }) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/admin/v1/access/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => client.invalidateQueries({ queryKey: ['security'] }) });
  if (query.isLoading) return <><PageHeader title="Security workspace" description="Sessions, alerts and audit integrity." /><LoadingState /></>;
  if (query.error) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const security = query.data!.security;
  const alerts = (security.alerts || []) as Row[];
  return <><PageHeader title="Security workspace" description="MFA posture, administrator sessions, alerts, invitations and archive-chain integrity." />
    <div className="metric-grid compact"><SecurityMetric label="Open alerts" value={alerts.filter(row => row.status === 'open').length} icon={<ShieldAlert />} /><SecurityMetric label="Active sessions" value={query.data!.sessions.items.filter(row => !row.revoked_at).length} icon={<Smartphone />} /><SecurityMetric label="Audit archives" value={Array.isArray(security.audit_archives) ? security.audit_archives.length : 0} icon={<CheckCircle2 />} /></div>
    <section className="resource-group"><div className="section-heading"><h2>Security alerts</h2><span>{alerts.length}</span></div><DataTable rows={alerts} onSelect={setSelected} preferred={['severity', 'kind', 'title', 'occurrence_count', 'status', 'last_seen_at']} /></section>
    <section className="resource-group"><div className="section-heading"><h2>Administrator sessions</h2><span>{query.data!.sessions.items.length}</span></div><DataTable rows={query.data!.sessions.items} onSelect={row => { if (row.id !== query.data!.sessions.current_session_id && auth.can('admins:manage') && confirm('Revoke this administrator session?')) revoke.mutate(String(row.id)); }} preferred={['email', 'ip', 'user_agent', 'created_at', 'last_used_at', 'expires_at', 'revoked_at']} /></section>
    {selected && <div className="modal-backdrop"><section className="modal"><header><div><p className="eyebrow">SECURITY ALERT</p><h2>{String(selected.title)}</h2></div><button className="icon-button" onClick={() => setSelected(null)}>×</button></header><pre className="json-view">{JSON.stringify(selected, null, 2)}</pre><footer><button className="button" onClick={() => alertMutation.mutate({ id: String(selected.id), status: 'acknowledged' })}>Acknowledge</button><button className="button primary" onClick={() => alertMutation.mutate({ id: String(selected.id), status: 'resolved' })}>Resolve</button></footer></section></div>}
  </>;
}

function SecurityMetric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="metric-card static"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>; }

export function AdminAccessPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [invite, setInvite] = useState({ email: '', name: '', role: 'readonly' });
  const [createdToken, setCreatedToken] = useState('');
  const [selectedAdmin, setSelectedAdmin] = useState<Row | null>(null);
  const [accessChange, setAccessChange] = useState({ role: 'readonly', active: true, password: '', totp: '' });
  const query = useQuery({ queryKey: ['admins'], queryFn: async () => Promise.all([api<{ items: Row[] }>('/api/admin/v1/access/admins'), api<{ items: Row[] }>('/api/admin/v1/access/invitations')]) });
  const mutation = useMutation({ mutationFn: () => api<{ invitation_token: string }>('/api/admin/v1/access/invitations', { method: 'POST', body: JSON.stringify(invite) }), onSuccess: data => { setCreatedToken(data.invitation_token); setInvite({ email: '', name: '', role: 'readonly' }); client.invalidateQueries({ queryKey: ['admins'] }); } });
  const revokeInvite = useMutation({ mutationFn: (id: string) => api(`/api/admin/v1/access/invitations/${id}/revoke`, { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['admins'] }) });
  const changeAccess = useMutation({ mutationFn: async () => {
    const id = String(selectedAdmin?.id);
    const authorization = await api<{ authorization_id: string }>('/api/admin/v1/action-authorizations', { method: 'POST', body: JSON.stringify({ action: 'admin.access_change', entity_id: id, payload_hash: `${accessChange.role}:${accessChange.active}`, password: accessChange.password, totp_code: accessChange.totp }) });
    return api(`/api/admin/v1/access/admins/${id}`, { method: 'PATCH', headers: { 'x-admin-action-authorization': authorization.authorization_id }, body: JSON.stringify({ role: accessChange.role, active: accessChange.active }) });
  }, onSuccess: () => { setSelectedAdmin(null); client.invalidateQueries({ queryKey: ['admins'] }); } });
  return <><PageHeader title="Administrator access" description="Fixed roles, mandatory MFA invitations and access lifecycle." />{auth.can('admins:manage') && <section className="panel invite-panel"><div className="panel-heading"><div><p className="eyebrow">NEW ADMINISTRATOR</p><h2>Create a 24-hour invitation</h2></div><UserPlus /></div><div className="inline-form"><label className="field grow"><span>Email</span><input type="email" value={invite.email} onChange={event => setInvite(value => ({ ...value, email: event.target.value }))} /></label><label className="field"><span>Name</span><input value={invite.name} onChange={event => setInvite(value => ({ ...value, name: event.target.value }))} /></label><label className="field"><span>Role</span><select value={invite.role} onChange={event => setInvite(value => ({ ...value, role: event.target.value }))}><option>readonly</option><option>support</option><option>finance</option></select></label><button className="button primary" disabled={!invite.email || mutation.isPending} onClick={() => mutation.mutate()}>Create invite</button></div>{createdToken && <div className="one-time-secret"><strong>Copy now — shown once</strong><code>{createdToken}</code><button className="button" onClick={() => navigator.clipboard.writeText(createdToken)}>Copy</button></div>}</section>}
    {query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <><section className="resource-group"><div className="section-heading"><h2>Administrators</h2><span>{query.data[0].items.length}</span></div><DataTable rows={query.data[0].items} onSelect={row => { if (!auth.can('admins:manage')) return; setSelectedAdmin(row); setAccessChange({ role: String(row.role), active: Boolean(row.active), password: '', totp: '' }); }} preferred={['email', 'name', 'role', 'active', 'totp_enabled', 'last_login_at']} /></section><section className="resource-group"><div className="section-heading"><h2>Invitations</h2><span>{query.data[1].items.length}</span></div><DataTable rows={query.data[1].items} onSelect={row => { if (auth.can('admins:manage') && !row.accepted_at && !row.revoked_at && confirm(`Revoke invitation for ${row.email}?`)) revokeInvite.mutate(String(row.id)); }} preferred={['email', 'name', 'role', 'expires_at', 'accepted_at', 'revoked_at']} /></section></>}
    {selectedAdmin && <div className="modal-backdrop"><section className="modal compact" role="dialog" aria-modal="true"><header><div><p className="eyebrow">CRITICAL OWNER ACTION</p><h2>Change access for {String(selectedAdmin.email)}</h2><p>Role or activation changes revoke affected access where required and are permanently audited.</p></div><button className="icon-button" onClick={() => setSelectedAdmin(null)} aria-label="Close">×</button></header><div className="form-grid"><label className="field"><span>Role</span><select value={accessChange.role} onChange={event => setAccessChange(value => ({ ...value, role: event.target.value }))}><option>readonly</option><option>support</option><option>finance</option><option>owner</option></select></label><label className="checkbox-field"><input type="checkbox" checked={accessChange.active} onChange={event => setAccessChange(value => ({ ...value, active: event.target.checked }))} /><span><strong>Active administrator</strong></span></label><label className="field"><span>Owner password</span><input type="password" autoComplete="current-password" value={accessChange.password} onChange={event => setAccessChange(value => ({ ...value, password: event.target.value }))} /></label><label className="field"><span>Fresh TOTP</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={accessChange.totp} onChange={event => setAccessChange(value => ({ ...value, totp: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /></label></div>{changeAccess.error && <p className="error-text">{changeAccess.error.message}</p>}<footer><button className="button" onClick={() => setSelectedAdmin(null)}>Cancel</button><button className="button danger" disabled={accessChange.password.length < 12 || accessChange.totp.length !== 6 || changeAccess.isPending} onClick={() => { if (confirm('Apply this administrator access change?')) changeAccess.mutate(); }}>{changeAccess.isPending ? 'Applying…' : 'Apply access change'}</button></footer></section></div>}
  </>;
}
