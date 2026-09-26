import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, KeyRound, RefreshCw, ShieldCheck, Smartphone, Store } from 'lucide-react';
import { api, format } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { askConfirm } from '@/shared/ui/confirm';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NativeSelect } from '@/shared/ui/textarea';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;

export function StoresPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['stores'], queryFn: () => api<{ stores: Row[] }>('/api/admin/v1/stores') });
  return <><PageHeader title="Stores" description="Seller lifecycle, catalog health, subscription and trust state." actions={<Button variant="outline" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</Button>} />{query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <DataTable rows={query.data.stores} onSelect={row => navigate(`/stores/${row.id}`)} preferred={['store_name', 'store_code', 'country_code', 'status', 'product_count', 'category_count', 'created_at']} />}</>;
}

export function StoreDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: ['store', id], queryFn: () => api<{ store: Row; subscription: Row | null; deletion: Row | null; devices: Row[] }>(`/api/admin/v1/stores/${id}`) });
  const statusMutation = useMutation({ mutationFn: () => api(`/api/admin/v1/stores/${id}`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }), onSuccess: () => { setReason(''); queryClient.invalidateQueries({ queryKey: ['store', id] }); queryClient.invalidateQueries({ queryKey: ['stores'] }); } });
  const deviceMutation = useMutation({ mutationFn: (rowId: unknown) => api(`/api/admin/v1/stores/${id}/devices/${rowId}`, { method: 'DELETE' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['store', id] }) });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data!;
  const storeRow = data.store;
  return <>
    <Link className="back-link" to="/stores"><ArrowLeft size={15} /> Back to stores</Link>
    <PageHeader title={String(storeRow.store_name)} description={`${storeRow.store_code} · ${storeRow.country_code || 'No country'} · Created ${format.date(storeRow.created_at, auth.admin?.timezone)}`} actions={<StatusBadge value={storeRow.status} />} />
    <div className="detail-grid"><Card><CardHeader className="flex items-start justify-between gap-3.5"><div><p className="eyebrow">STORE PROFILE</p><CardTitle>Account overview</CardTitle></div><Store /></CardHeader><CardContent><dl className="key-values">{['public_identifier', 'phone', 'email', 'slug', 'product_count', 'category_count', 'order_count', 'updated_at'].map(key => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(storeRow[key] ?? '—')}</dd></div>)}</dl></CardContent></Card>
    <Card><CardHeader className="flex items-start justify-between gap-3.5"><div><p className="eyebrow">SUBSCRIPTION</p><CardTitle>Commercial state</CardTitle></div><ShieldCheck /></CardHeader><CardContent>{data.subscription ? <dl className="key-values">{Object.entries(data.subscription).slice(0, 10).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl> : <div className="empty-state">No subscription record</div>}</CardContent></Card></div>
    <Card className="mt-5"><CardHeader className="flex items-start justify-between gap-3.5"><div><p className="eyebrow">SECURITY</p><CardTitle>Devices</CardTitle></div><Smartphone /></CardHeader><CardContent><DataTable rows={data.devices} preferred={['device_label', 'platform', 'app_version', 'created_at', 'last_used_at']} onSelect={row => { if (row.row_id) askConfirm('Revoke this device session?', () => deviceMutation.mutate(row.row_id)); }} /></CardContent></Card>
    {auth.can('sellers:manage') && <section className="danger-zone"><div><Ban /><div><h2>Account status</h2><p>Suspending or banning a seller blocks credentialed APIs and shows the restricted-account state in Android.</p></div></div><div className="inline-form"><Field label="New status"><NativeSelect value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active / restore</option><option value="suspended">Suspended</option><option value="banned">Banned</option></NativeSelect></Field><Field label="Audited reason" className="flex-1"><Input value={reason} onChange={event => setReason(event.target.value)} placeholder="Required operational reason" /></Field><Button variant="destructive" disabled={reason.trim().length < 5 || statusMutation.isPending} onClick={() => { askConfirm(`Change this seller to ${status}?`, () => statusMutation.mutate()); }}>{statusMutation.isPending ? 'Applying…' : 'Apply status'}</Button></div>{statusMutation.error && <p className="error-text">{statusMutation.error.message}</p>}</section>}
    {data.deletion && <Card className="mt-5"><CardHeader className="flex items-start justify-between gap-3.5"><div><p className="eyebrow">DELETION</p><CardTitle>Latest request</CardTitle></div><KeyRound /></CardHeader><CardContent><pre className="json-view">{JSON.stringify(data.deletion, null, 2)}</pre></CardContent></Card>}
  </>;
}
