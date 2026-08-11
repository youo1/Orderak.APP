import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { api } from '@/shared/api/client';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { useAuth } from '@/features/auth/auth-context';

type Control = { deployment_gate: boolean; admin_enabled?: boolean; effective: boolean };

export function RuntimePage() {
  const auth = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['runtime'], queryFn: () => api<{ controls: Record<string, Control> }>('/api/admin/v1/runtime-config') });
  const [values, setValues] = useState<Record<string, boolean>>({});
  useEffect(() => { if (query.data) setValues(Object.fromEntries(Object.entries(query.data.controls).map(([key, value]) => [key, value.admin_enabled ?? value.effective]))); }, [query.data]);
  const mutation = useMutation({ mutationFn: () => api('/api/admin/v1/runtime-config', { method: 'PATCH', body: JSON.stringify({ ai_enabled: values.ai, billing_enabled: values.billing }) }), onSuccess: () => client.invalidateQueries({ queryKey: ['runtime'] }) });
  return <><PageHeader title="Runtime configuration" description="Typed controls with their effective state and immutable deployment gates." actions={auth.can('settings:manage') ? <button className="button primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>Save controls</button> : undefined} />{query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <div className="control-list">{Object.entries(query.data.controls).map(([key, control]) => <section className="control-row" key={key}><div className="control-icon"><LockKeyhole /></div><div><h2>{key.replaceAll('_', ' ')}</h2><p>{control.deployment_gate ? 'Deployment gate is enabled; admin state can still disable it.' : 'Deployment hard gate is off. The panel cannot enable this capability.'}</p><div className="status-line"><span className={control.deployment_gate ? 'dot on' : 'dot'} /> Environment <strong>{control.deployment_gate ? 'On' : 'Off'}</strong><span className={control.effective ? 'dot on' : 'dot'} /> Effective <strong>{control.effective ? 'On' : 'Off'}</strong></div></div>{control.admin_enabled == null ? <span className="status neutral">display only</span> : <label className="switch"><input type="checkbox" checked={values[key] ?? false} disabled={!auth.can('settings:manage')} onChange={event => setValues(current => ({ ...current, [key]: event.target.checked }))} /><span /></label>}</section>)}</div>}</>;
}
