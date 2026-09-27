import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, GitBranchPlus, RefreshCw, Rocket, RotateCcw, Save } from 'lucide-react';
import { api } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { askConfirm } from '@/shared/ui/confirm';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NativeSelect } from '@/shared/ui/textarea';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;
type Payload = { plans: Row[]; revisions: Row[]; definitions: Row[]; values: Row[] };

export function PlansPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['plan-catalog'], queryFn: () => api<Payload>('/api/admin/v1/plan-catalog') });
  const [planId, setPlanId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [entitlementKey, setEntitlementKey] = useState('');
  const [mode, setMode] = useState('value');
  const [rawValue, setRawValue] = useState('');
  const [changeType, setChangeType] = useState('mixed');
  const [assessment, setAssessment] = useState<unknown>(null);
  const [override, setOverride] = useState({ organization: '', entitlement: '', mode: 'value', value: '', reason: '' });
  const [testLab, setTestLab] = useState({ organization: '', plan: 'paid1', hours: '4', reason: '' });
  const [testLabResult, setTestLabResult] = useState<unknown>(null);
  const isStaging = window.location.hostname === 'admin.staging.orderak.app'
    || window.location.hostname === 'orderak-admin-staging.pages.dev';
  const data = query.data;
  const effectivePlanId = planId || String(data?.plans[0]?.id ?? '');
  const plan = data?.plans.find(item => String(item.id) === effectivePlanId);
  const revisions = data?.revisions.filter(item => String(item.plan_id) === effectivePlanId) ?? [];
  const draft = revisions.find(item => item.status === 'draft');
  const effectiveRevisionId = revisionId || String(draft?.id ?? plan?.current_revision_id ?? '');
  const revision = revisions.find(item => String(item.id) === effectiveRevisionId);
  const values = useMemo(() => new Map((data?.values ?? []).filter(item => String(item.revision_id) === effectiveRevisionId).map(item => [String(item.entitlement_key), item])), [data?.values, effectiveRevisionId]);
  const definition = data?.definitions.find(item => String(item.entitlement_key) === entitlementKey);
  const refresh = () => client.invalidateQueries({ queryKey: ['plan-catalog'] });
  const createDraft = useMutation({ mutationFn: () => api<{ draft: Row }>(`/api/admin/v1/plans/${encodeURIComponent(effectivePlanId)}/drafts`, { method: 'POST' }), onSuccess: response => { setRevisionId(String(response.draft.id)); refresh(); } });
  const save = useMutation({ mutationFn: () => {
    const valueType = String(definition?.value_type ?? 'text');
    const value: Row = { entitlement_key: entitlementKey, value_mode: mode, display_value: mode === 'unlimited' ? 'Unlimited' : mode === 'disabled' ? 'Disabled' : rawValue };
    if (mode === 'value') {
      if (valueType === 'boolean') value.bool_value = rawValue === 'true';
      else if (valueType === 'integer') value.int_value = Number(rawValue);
      else value.text_value = rawValue;
    }
    return api(`/api/admin/v1/plan-revisions/${encodeURIComponent(effectiveRevisionId)}`, { method: 'PATCH', headers: { 'if-match': String(revision?.lock_version ?? 0) }, body: JSON.stringify({ change_type: changeType, entitlements: [value] }) });
  }, onSuccess: refresh });
  const inspect = useMutation({ mutationFn: async () => {
    const validation = await api(`/api/admin/v1/plan-revisions/${encodeURIComponent(effectiveRevisionId)}/validate`, { method: 'POST' });
    const impact = await api(`/api/admin/v1/plan-revisions/${encodeURIComponent(effectiveRevisionId)}/impact`);
    return { validation, impact };
  }, onSuccess: setAssessment });
  const publish = useMutation({ mutationFn: () => api(`/api/admin/v1/plan-revisions/${encodeURIComponent(effectiveRevisionId)}/publish`, { method: 'POST' }), onSuccess: () => { setAssessment(null); setRevisionId(''); refresh(); } });
  const addOverride = useMutation({ mutationFn: () => {
    const body: Row = { entitlement_key: override.entitlement, value_mode: override.mode, reason: override.reason };
    if (override.mode === 'value') {
      if (Number.isFinite(Number(override.value)) && override.value.trim() !== '') body.int_value = Number(override.value);
      else body.text_value = override.value;
    }
    return api(`/api/admin/v1/organizations/${encodeURIComponent(override.organization)}/entitlement-overrides`, { method: 'POST', body: JSON.stringify(body) });
  }, onSuccess: () => setOverride({ organization: '', entitlement: '', mode: 'value', value: '', reason: '' }) });
  const applyTestPlan = useMutation({ mutationFn: () => api(`/api/admin/v1/test-lab/organizations/${encodeURIComponent(testLab.organization)}/plan`, {
    method: 'POST',
    body: JSON.stringify({
      plan_key: testLab.plan,
      reason: testLab.reason,
      expires_at: new Date(Date.now() + Number(testLab.hours) * 60 * 60 * 1000).toISOString(),
    }),
  }), onSuccess: setTestLabResult });
  const resetTestPlan = useMutation({ mutationFn: () => api(`/api/admin/v1/test-lab/organizations/${encodeURIComponent(testLab.organization)}/plan`, {
    method: 'DELETE',
  }), onSuccess: setTestLabResult });

  if (query.isLoading) return <><PageHeader title="Plans & limits" description="Immutable plan revisions and enforced entitlement limits." /><LoadingState /></>;
  if (query.error || !data) return <ErrorState error={query.error as Error} retry={() => query.refetch()} />;
  const configurable = data.definitions.filter(item => Number(item.admin_configurable) && item.implementation_status === 'implemented');
  return <><PageHeader title="Plans & limits" description="Draft safely, validate the entitlement ladder, inspect subscriber impact, then publish an immutable revision." actions={<Button variant="outline" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</Button>} />
    <section className="truth-banner"><CheckCircle2 /><div><strong>Only implemented entitlements are editable</strong><p>Display-only and planned definitions remain visible, but the API rejects attempts to configure them.</p></div></section>
    <div className="plan-selector">
      {data.plans.map(item => <button className={`plan-card ${String(item.id) === effectivePlanId ? 'selected' : ''}`} key={String(item.id)} onClick={() => { setPlanId(String(item.id)); setRevisionId(''); setAssessment(null); }}><span>{String(item.plan_key)}</span><strong>{String(item.name ?? item.plan_key)}</strong><StatusBadge value={item.revision_status} /><small>Revision {String(item.version ?? '—')}</small></button>)}
    </div>
    <Card>
      <CardHeader className="flex items-start justify-between gap-3.5 space-y-0">
        <div><p className="eyebrow">REVISION WORKSPACE</p><CardTitle>{String(plan?.name ?? plan?.plan_key ?? 'Plan')}</CardTitle></div>
        {auth.can('plans:draft') && !draft && <Button disabled={createDraft.isPending} onClick={() => createDraft.mutate()}><GitBranchPlus size={16} /> Create draft</Button>}
      </CardHeader>
      <CardContent>
        <div className="inline-form">
          <Field label="Revision" className="grow">
            <NativeSelect value={effectiveRevisionId} onChange={event => { setRevisionId(event.target.value); setAssessment(null); }}>{revisions.map(item => <option key={String(item.id)} value={String(item.id)}>v{String(item.version)} · {String(item.status)}</option>)}</NativeSelect>
          </Field>
          {revision && <StatusBadge value={revision.status} />}
        </div>
        {revision?.status === 'draft' && auth.can('plans:draft') && <div className="governed-editor">
          <Field label="Implemented entitlement" className="grow">
            <NativeSelect value={entitlementKey} onChange={event => { setEntitlementKey(event.target.value); const existing = values.get(event.target.value); setMode(String(existing?.value_mode ?? 'value')); setRawValue(String(existing?.int_value ?? (Number(existing?.bool_value) ? 'true' : existing?.bool_value === 0 ? 'false' : existing?.text_value ?? ''))); }}><option value="">Select…</option>{configurable.map(item => <option value={String(item.entitlement_key)} key={String(item.entitlement_key)}>{String(item.name)} · {String(item.entitlement_key)}</option>)}</NativeSelect>
          </Field>
          <Field label="Mode">
            <NativeSelect value={mode} onChange={event => setMode(event.target.value)}><option>value</option><option>disabled</option>{Number(definition?.supports_unlimited) === 1 && <option>unlimited</option>}</NativeSelect>
          </Field>
          {mode === 'value' && <Field label="Value">
            {definition?.value_type === 'boolean' ? <NativeSelect value={rawValue} onChange={event => setRawValue(event.target.value)}><option value="true">Enabled</option><option value="false">Disabled</option></NativeSelect> : <Input type={definition?.value_type === 'integer' ? 'number' : 'text'} min={0} value={rawValue} onChange={event => setRawValue(event.target.value)} />}
          </Field>}
          <Field label="Change type">
            <NativeSelect value={changeType} onChange={event => setChangeType(event.target.value)}><option>additive</option><option>restrictive</option><option>mixed</option></NativeSelect>
          </Field>
          <Button disabled={!entitlementKey || save.isPending} onClick={() => save.mutate()}><Save size={16} /> Save value</Button>
        </div>}
        <div className="button-row">
          {revision?.status === 'draft' && <Button variant="outline" disabled={inspect.isPending} onClick={() => inspect.mutate()}><CheckCircle2 size={16} /> Validate & inspect impact</Button>}
          {revision?.status === 'draft' && auth.can('plans:publish') && <Button variant="destructive" disabled={publish.isPending || !assessment} onClick={() => { askConfirm('Publish this immutable plan revision? Restrictive changes apply at renewal.', () => publish.mutate()); }}><Rocket size={16} /> Publish revision</Button>}
        </div>
        {assessment !== null && <pre className="json-view">{JSON.stringify(assessment, null, 2)}</pre>}
        {[createDraft.error, save.error, inspect.error, publish.error].filter(Boolean).map((error, index) => <p className="error-text" key={index}>{(error as Error).message}</p>)}
      </CardContent>
    </Card>
    <section className="resource-group"><div className="section-heading"><h2>Entitlement matrix</h2><span>{data.definitions.length}</span></div><DataTable rows={data.definitions.map(item => ({ ...item, current_value: values.get(String(item.entitlement_key))?.display_value ?? values.get(String(item.entitlement_key))?.value_mode ?? '—' }))} preferred={['name', 'entitlement_key', 'category', 'implementation_status', 'admin_configurable', 'current_value']} /></section>
    {isStaging && auth.can('subscriptions:manage') && <Card>
      <CardHeader>
        <div><p className="eyebrow">STAGING ONLY</p><CardTitle><FlaskConical size={20} /> Subscription Test Lab</CardTitle><CardDescription>Temporarily mirror an implemented plan for a test organization. Every override expires within 24 hours.</CardDescription></div>
      </CardHeader>
      <CardContent>
        <div className="governed-editor">
          <Field label="Test organization ID" className="grow">
            <Input value={testLab.organization} onChange={event => setTestLab(value => ({ ...value, organization: event.target.value }))} />
          </Field>
          <Field label="Plan to simulate">
            <NativeSelect value={testLab.plan} onChange={event => setTestLab(value => ({ ...value, plan: event.target.value }))}>{data.plans.filter(item => item.plan_key !== 'paid3').map(item => <option value={String(item.plan_key)} key={String(item.plan_key)}>{String(item.name ?? item.plan_key)}</option>)}</NativeSelect>
          </Field>
          <Field label="Expires after">
            <NativeSelect value={testLab.hours} onChange={event => setTestLab(value => ({ ...value, hours: event.target.value }))}><option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option></NativeSelect>
          </Field>
          <Field label="Test reason" className="grow">
            <Input minLength={8} value={testLab.reason} onChange={event => setTestLab(value => ({ ...value, reason: event.target.value }))} />
          </Field>
          <Button disabled={!testLab.organization || testLab.reason.length < 8 || applyTestPlan.isPending} onClick={() => applyTestPlan.mutate()}><FlaskConical size={16} /> Apply test plan</Button>
          <Button variant="destructive" disabled={!testLab.organization || resetTestPlan.isPending} onClick={() => { askConfirm('Reset every active Test Lab override for this organization?', () => resetTestPlan.mutate()); }}><RotateCcw size={16} /> Reset</Button>
        </div>
        {testLabResult !== null && <pre className="json-view">{JSON.stringify(testLabResult, null, 2)}</pre>}
        {[applyTestPlan.error, resetTestPlan.error].filter(Boolean).map((error, index) => <p className="error-text" key={index}>{(error as Error).message}</p>)}
      </CardContent>
    </Card>}
    {!isStaging && auth.can('subscriptions:manage') && <Card>
      <CardHeader>
        <div><p className="eyebrow">ORGANIZATION EXCEPTION</p><CardTitle>Audited entitlement override</CardTitle></div>
      </CardHeader>
      <CardContent>
        <div className="governed-editor">
          <Field label="Organization ID" className="grow">
            <Input value={override.organization} onChange={event => setOverride(value => ({ ...value, organization: event.target.value }))} />
          </Field>
          <Field label="Implemented entitlement key" className="grow">
            <NativeSelect value={override.entitlement} onChange={event => setOverride(value => ({ ...value, entitlement: event.target.value }))}><option value="">Select…</option>{configurable.map(item => <option key={String(item.entitlement_key)}>{String(item.entitlement_key)}</option>)}</NativeSelect>
          </Field>
          <Field label="Mode">
            <NativeSelect value={override.mode} onChange={event => setOverride(value => ({ ...value, mode: event.target.value }))}><option>value</option><option>disabled</option><option>unlimited</option></NativeSelect>
          </Field>
          <Field label="Value">
            <Input value={override.value} onChange={event => setOverride(value => ({ ...value, value: event.target.value }))} />
          </Field>
          <Field label="Required reason" className="grow">
            <Input value={override.reason} onChange={event => setOverride(value => ({ ...value, reason: event.target.value }))} />
          </Field>
          <Button disabled={!override.organization || !override.entitlement || !override.reason || addOverride.isPending} onClick={() => addOverride.mutate()}>Create override</Button>
        </div>
        {addOverride.error && <p className="error-text">{addOverride.error.message}</p>}
      </CardContent>
    </Card>}
  </>;
}
