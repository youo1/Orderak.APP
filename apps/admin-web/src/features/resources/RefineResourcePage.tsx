import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CanAccess, useList } from '@refinedev/core';
import { Download, Plus, RefreshCw } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { Section } from '@/app/config/sections';
import { DataTable } from '@/shared/ui/DataTable';
import { DetailPanel, ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { STEP_UP_UNAVAILABLE, useStepUp } from '@/shared/api/step-up';
import { askConfirm } from '@/shared/ui/confirm';
import { actions } from '@/app/config/actions';
import { ActionDialog } from '@/shared/ui/ActionDialog';
import { useAuth } from '@/features/auth/auth-context';
import type { Row } from '@/shared/refine/resource-shape';

/**
 * Generic Refine-backed list page for every formerly-generic ResourcePage
 * section EXCEPT `flags`/`capabilities` (see ResourcePage.tsx — those two
 * genuinely return more than one row group per response, which doesn't fit
 * Refine's one-resource-one-array `getList`). Gated with `<CanAccess>`
 * instead of the route-level `<Permission>` wrapper, matching audit/tasks
 * (Phases 1–2 of the Refine install plan).
 *
 * The bespoke per-resource actions below (billing health, translation
 * approve/reject, content publish, privacy transitions, export download)
 * are domain commands, not generic CRUD — they still call `api()` directly,
 * unchanged from the pre-Refine version, except that they now call the
 * `refetch` passed down from this page's `useList` instead of invalidating
 * the old `['resource', id]` TanStack Query key, which no longer has
 * anything subscribed to it now that the list itself comes from Refine's
 * own (differently-keyed) query.
 *
 * They do, however, render through the shared kit like the rest of the
 * panel: the hand-rolled `.button`, `.field`, `.panel` and `.modal` these
 * moved with are the primitives RD-16 replaced.
 */
export function RefineResourcePage({ section }: { section: Section }) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const auth = useAuth();
  const action = actions[section.id];
  const { result, query } = useList<Row>({ resource: section.id, pagination: { mode: 'off' } });
  const refetch = () => { query.refetch(); };
  return <CanAccess resource={section.id} action="list">
    <PageHeader title={section.label} description={section.description} actions={<>{action && auth.can(action.permission) && <Button onClick={() => setActionOpen(true)}><Plus size={16} /> {action.label}</Button>}<Button variant="outline" onClick={refetch}><RefreshCw size={16} /> Refresh</Button></>} />
    {query.isLoading && <LoadingState />}
    {query.error && <ErrorState error={query.error} retry={refetch} />}
    {section.id === 'subscriptions' && <BillingLeaseHealth />}
    {!query.isLoading && !query.error && <DataTable rows={result.data} onSelect={setSelected} preferred={preferredColumns[section.id] || []} />}
    {selected && <DetailPanel title={String(selected.name ?? selected.store_name ?? selected.subject ?? selected.id ?? section.label)} row={selected} onClose={() => setSelected(null)} actions={section.id === 'exports' ? <ExportDownload row={selected} /> : section.id === 'privacy' ? <PrivacyActions row={selected} close={() => setSelected(null)} refetch={refetch} /> : section.id === 'translations' ? <TranslationActions row={selected} close={() => setSelected(null)} refetch={refetch} /> : section.id === 'content' ? <ContentActions row={selected} close={() => setSelected(null)} refetch={refetch} /> : undefined} />}
    {actionOpen && action && <ActionDialog config={action} resourceKey={section.id} close={() => setActionOpen(false)} onSuccess={refetch} />}
  </CanAccess>;
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
  return <Card>
    <CardHeader className="panel-heading"><div><p className="eyebrow">PLAY CLAIM LEASE</p><CardTitle>Verification duration and reclaim health</CardTitle><CardDescription>Lease changes require observed percentile evidence. A reclaim can duplicate a non-charging Google verification or acknowledgement call.</CardDescription></div><span className={review ? 'status danger' : 'status active'}>{review ? 'Review lease' : 'Within lease'}</span></CardHeader>
    <CardContent>
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
    </CardContent>
  </Card>;
}

function TranslationActions({ row, close, refetch }: { row: Row; close: () => void; refetch: () => void }) {
  const mutation = useMutation({ mutationFn: (status: 'reviewed' | 'rejected') => api(`/api/admin/v1/product-translations/${encodeURIComponent(String(row.product_code))}/${encodeURIComponent(String(row.lang))}`, { method: 'PATCH', body: JSON.stringify({ status }) }), onSuccess: () => { refetch(); close(); } });
  return <><p className="muted">Rejected or stale content falls back to seller-authored source text at runtime.</p><div className="button-row"><Button disabled={mutation.isPending} onClick={() => mutation.mutate('reviewed')}>Approve current translation</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => { askConfirm('Reject this translation and use seller-authored fallback?', () => mutation.mutate('rejected')); }}>Reject and fall back</Button></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}</>;
}

function ContentActions({ row, close, refetch }: { row: Row; close: () => void; refetch: () => void }) {
  const mutation = useMutation({ mutationFn: () => api(`/api/admin/v1/content-configs/${encodeURIComponent(String(row.id))}/publish`, { method: 'POST', body: '{}' }), onSuccess: () => { refetch(); close(); } });
  if (row.status !== 'draft') return <p className="muted">Published content remains immutable; create a new version to change it.</p>;
  return <><p className="muted">Publishing retires the previous version for the same content key and locale.</p><Button disabled={mutation.isPending} onClick={() => { askConfirm('Publish this content version?', () => mutation.mutate()); }}>Publish version</Button>{mutation.error && <p className="error-text">{mutation.error.message}</p>}</>;
}

function PrivacyActions({ row, close, refetch }: { row: Row; close: () => void; refetch: () => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [phone, setPhone] = useState('');
  const [correctedName, setCorrectedName] = useState('');
  const [notes, setNotes] = useState('');
  const current = String(row.status);
  const next = current === 'open' ? ['verified', 'rejected'] : current === 'verified' ? ['in_progress', 'rejected'] : current === 'in_progress' ? ['completed', 'rejected'] : [];
  const needsIdentity = target === 'completed' && ['deletion', 'correction'].includes(String(row.request_type));
  const mutation = useMutation({ mutationFn: () => api(`/api/admin/v1/buyer-privacy/${encodeURIComponent(String(row.id))}`, { method: 'PATCH', body: JSON.stringify({ status: target, buyer_phone: phone || undefined, corrected_name: correctedName || undefined, notes }) }), onSuccess: () => { refetch(); setOpen(false); close(); } });
  if (!next.length) return <p className="muted">This request has reached a terminal state.</p>;
  return <><div className="button-row">{next.map(status => <Button variant={status === 'rejected' ? 'destructive' : 'default'} key={status} onClick={() => { setTarget(status); setOpen(true); }}>{status.replace('_', ' ')}</Button>)}</div><Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) setOpen(false); }}><DialogContent className="w-[min(620px,calc(100vw-32px))]"><DialogHeader><p className="eyebrow">PRIVACY WORKFLOW</p><DialogTitle>Move request to {target.replace('_', ' ')}</DialogTitle><DialogDescription>Every transition is recorded in the immutable admin audit trail.</DialogDescription></DialogHeader><div className="form-grid">{needsIdentity && <Field label="Re-enter customer phone *"><Input value={phone} onChange={event => setPhone(event.target.value)} /></Field>}{needsIdentity && row.request_type === 'correction' && <Field label="Corrected customer name *"><Input value={correctedName} onChange={event => setCorrectedName(event.target.value)} /></Field>}<Field label="Evidence / resolution note" className="wide"><Textarea rows={4} value={notes} onChange={event => setNotes(event.target.value)} /></Field></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={mutation.isPending || (needsIdentity && phone.replace(/\D/g, '').length < 7) || (needsIdentity && row.request_type === 'correction' && !correctedName.trim())} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Applying…' : 'Confirm transition'}</Button></DialogFooter></DialogContent></Dialog></>;
}

function ExportDownload({ row }: { row: Row }) {
  const [freshOpen, setFreshOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const stepUp = useStepUp();
  const completed = row.status === 'completed' && !row.downloaded_at;
  const sensitive = row.classification === 'sensitive';
  const mutation = useMutation({ mutationFn: async () => {
    const headers = new Headers();
    if (sensitive) {
      const authorizationId = await stepUp.authorize('export.sensitive', String(row.id), 'export-download', password, totpCode);
      headers.set('x-admin-action-authorization', authorizationId);
    }
    const result = await api<{ download_url: string }>(`/api/admin/v1/exports/${encodeURIComponent(String(row.id))}/download`, { method: 'POST', headers, body: JSON.stringify({ acknowledgement: 'admin_ui_download' }) });
    // Same-origin only. This navigates the console to a URL the response body
    // supplied, so it is worth one check: the artifact is served from this
    // origin behind the one-use cookie, and anything else — an absolute URL to
    // somewhere else, or a `javascript:` scheme — is not a download.
    const target = new URL(result.download_url, window.location.origin);
    if (target.origin !== window.location.origin) throw new Error('Refusing an off-origin download URL.');
    window.location.assign(target.href);
  }, onSuccess: () => setFreshOpen(false) });
  if (!completed) return <p className="muted">Download becomes available once this private artifact completes. Tokens are one-use and expire in five minutes.</p>;
  return <><Button onClick={() => { if (sensitive && !stepUp.available) return; if (sensitive) setFreshOpen(true); else mutation.mutate(); }} disabled={mutation.isPending || (sensitive && !stepUp.available)}><Download size={16} /> Download once</Button>{mutation.error && <p className="error-text">{mutation.error.message}</p>}{sensitive && !stepUp.available && <p className="error-text">{STEP_UP_UNAVAILABLE}</p>}<Dialog open={freshOpen} onOpenChange={nextOpen => { if (!nextOpen) setFreshOpen(false); }}><DialogContent className="w-[min(620px,calc(100vw-32px))]"><DialogHeader><p className="eyebrow">FRESH OWNER AUTH</p><DialogTitle>Authorize sensitive download</DialogTitle><DialogDescription>Password and a current TOTP are required. This authorization is bound to this one export and consumed once.</DialogDescription></DialogHeader><div className="form-grid"><Field label="Owner password"><Input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></Field><Field label="Current TOTP"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field></div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}<DialogFooter><Button variant="outline" onClick={() => setFreshOpen(false)}>Cancel</Button><Button disabled={password.length < 12 || totpCode.length !== 6 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Authorizing…' : 'Authorize and download'}</Button></DialogFooter></DialogContent></Dialog></>;
}

const preferredColumns: Record<string, string[]> = {
  buyers: ['buyer_name', 'buyer_phone', 'store_name', 'order_count', 'total_minor', 'last_order_at', 'restricted'],
  subscriptions: ['store_name', 'plan_id', 'status', 'gateway', 'organization_status', 'current_period_end'],
  versions: ['platform', 'country_code', 'minimum_version_code', 'recommended_version_code', 'maintenance_mode', 'active', 'updated_at'],
};
