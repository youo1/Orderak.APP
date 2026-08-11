import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, GitBranchPlus, RefreshCw, Rocket, RotateCcw, Save } from 'lucide-react';
import { api } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
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
  return <><PageHeader title="Plans & limits" description="Draft safely, validate the entitlement ladder, inspect subscriber impact, then publish an immutable revision." actions={<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button>} />
    <section className="truth-banner"><CheckCircle2 /><div><strong>Only implemented entitlements are editable</strong><p>Display-only and planned definitions remain visible, but the API rejects attempts to configure them.</p></div></section>
    <div className="plan-selector">{data.plans.map(item => <button className={`plan-card ${String(item.id) === effectivePlanId ? 'selected' : ''}`} key={String(item.id)} onClick={() => { setPlanId(String(item.id)); setRevisionId(''); setAssessment(null); }}><span>{String(item.plan_key)}</span><strong>{String(item.name ?? item.plan_key)}</strong><StatusBadge value={item.revision_status} /><small>Revision {String(item.version ?? '—')}</small></button>)}</div>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">REVISION WORKSPACE</p><h2>{String(plan?.name ?? plan?.plan_key ?? 'Plan')}</h2></div>{auth.can('plans:draft') && !draft && <button className="button primary" disabled={createDraft.isPending} onClick={() => createDraft.mutate()}><GitBranchPlus size={16} /> Create draft</button>}</div>
      <div className="inline-form"><label className="field grow"><span>Revision</span><select value={effectiveRevisionId} onChange={event => { setRevisionId(event.target.value); setAssessment(null); }}>{revisions.map(item => <option key={String(item.id)} value={String(item.id)}>v{String(item.version)} · {String(item.status)}</option>)}</select></label>{revision && <StatusBadge value={revision.status} />}</div>
      {revision?.status === 'draft' && auth.can('plans:draft') && <div className="governed-editor"><label className="field grow"><span>Implemented entitlement</span><select value={entitlementKey} onChange={event => { setEntitlementKey(event.target.value); const existing = values.get(event.target.value); setMode(String(existing?.value_mode ?? 'value')); setRawValue(String(existing?.int_value ?? (Number(existing?.bool_value) ? 'true' : existing?.bool_value === 0 ? 'false' : existing?.text_value ?? ''))); }}><option value="">Select…</option>{configurable.map(item => <option value={String(item.entitlement_key)} key={String(item.entitlement_key)}>{String(item.name)} · {String(item.entitlement_key)}</option>)}</select></label><label className="field"><span>Mode</span><select value={mode} onChange={event => setMode(event.target.value)}><option>value</option><option>disabled</option>{Number(definition?.supports_unlimited) === 1 && <option>unlimited</option>}</select></label>{mode === 'value' && <label className="field"><span>Value</span>{definition?.value_type === 'boolean' ? <select value={rawValue} onChange={event => setRawValue(event.target.value)}><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input type={definition?.value_type === 'integer' ? 'number' : 'text'} min={0} value={rawValue} onChange={event => setRawValue(event.target.value)} />}</label>}<label className="field"><span>Change type</span><select value={changeType} onChange={event => setChangeType(event.target.value)}><option>additive</option><option>restrictive</option><option>mixed</option></select></label><button className="button primary" disabled={!entitlementKey || save.isPending} onClick={() => save.mutate()}><Save size={16} /> Save value</button></div>}
      <div className="button-row">{revision?.status === 'draft' && <button className="button" disabled={inspect.isPending} onClick={() => inspect.mutate()}><CheckCircle2 size={16} /> Validate & inspect impact</button>}{revision?.status === 'draft' && auth.can('plans:publish') && <button className="button danger" disabled={publish.isPending || !assessment} onClick={() => { if (confirm('Publish this immutable plan revision? Restrictive changes apply at renewal.')) publish.mutate(); }}><Rocket size={16} /> Publish revision</button>}</div>{assessment !== null && <pre className="json-view">{JSON.stringify(assessment, null, 2)}</pre>}{[createDraft.error, save.error, inspect.error, publish.error].filter(Boolean).map((error, index) => <p className="error-text" key={index}>{(error as Error).message}</p>)}
    </section>
    <section className="resource-group"><div className="section-heading"><h2>Entitlement matrix</h2><span>{data.definitions.length}</span></div><DataTable rows={data.definitions.map(item => ({ ...item, current_value: values.get(String(item.entitlement_key))?.display_value ?? values.get(String(item.entitlement_key))?.value_mode ?? '—' }))} preferred={['name', 'entitlement_key', 'category', 'implementation_status', 'admin_configurable', 'current_value']} /></section>
    {isStaging && auth.can('subscriptions:manage') && <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">STAGING ONLY</p><h2><FlaskConical size={20} /> Subscription Test Lab</h2><p>Temporarily mirror an implemented plan for a test organization. Every override expires within 24 hours.</p></div></div>
      <div className="governed-editor">
        <label className="field grow"><span>Test organization ID</span><input value={testLab.organization} onChange={event => setTestLab(value => ({ ...value, organization: event.target.value }))} /></label>
        <label className="field"><span>Plan to simulate</span><select value={testLab.plan} onChange={event => setTestLab(value => ({ ...value, plan: event.target.value }))}>{data.plans.filter(item => item.plan_key !== 'paid3').map(item => <option value={String(item.plan_key)} key={String(item.plan_key)}>{String(item.name ?? item.plan_key)}</option>)}</select></label>
        <label className="field"><span>Expires after</span><select value={testLab.hours} onChange={event => setTestLab(value => ({ ...value, hours: event.target.value }))}><option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option></select></label>
        <label className="field grow"><span>Test reason</span><input minLength={8} value={testLab.reason} onChange={event => setTestLab(value => ({ ...value, reason: event.target.value }))} /></label>
        <button className="button primary" disabled={!testLab.organization || testLab.reason.length < 8 || applyTestPlan.isPending} onClick={() => applyTestPlan.mutate()}><FlaskConical size={16} /> Apply test plan</button>
        <button className="button danger" disabled={!testLab.organization || resetTestPlan.isPending} onClick={() => { if (confirm('Reset every active Test Lab override for this organization?')) resetTestPlan.mutate(); }}><RotateCcw size={16} /> Reset</button>
      </div>
      {testLabResult !== null && <pre className="json-view">{JSON.stringify(testLabResult, null, 2)}</pre>}
      {[applyTestPlan.error, resetTestPlan.error].filter(Boolean).map((error, index) => <p className="error-text" key={index}>{(error as Error).message}</p>)}
    </section>}
    {!isStaging && auth.can('subscriptions:manage') && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ORGANIZATION EXCEPTION</p><h2>Audited entitlement override</h2></div></div><div className="governed-editor"><label className="field grow"><span>Organization ID</span><input value={override.organization} onChange={event => setOverride(value => ({ ...value, organization: event.target.value }))} /></label><label className="field grow"><span>Implemented entitlement key</span><select value={override.entitlement} onChange={event => setOverride(value => ({ ...value, entitlement: event.target.value }))}><option value="">Select…</option>{configurable.map(item => <option key={String(item.entitlement_key)}>{String(item.entitlement_key)}</option>)}</select></label><label className="field"><span>Mode</span><select value={override.mode} onChange={event => setOverride(value => ({ ...value, mode: event.target.value }))}><option>value</option><option>disabled</option><option>unlimited</option></select></label><label className="field"><span>Value</span><input value={override.value} onChange={event => setOverride(value => ({ ...value, value: event.target.value }))} /></label><label className="field grow"><span>Required reason</span><input value={override.reason} onChange={event => setOverride(value => ({ ...value, reason: event.target.value }))} /></label><button className="button primary" disabled={!override.organization || !override.entitlement || !override.reason || addOverride.isPending} onClick={() => addOverride.mutate()}>Create override</button></div>{addOverride.error && <p className="error-text">{addOverride.error.message}</p>}</section>}
  </>;
}
