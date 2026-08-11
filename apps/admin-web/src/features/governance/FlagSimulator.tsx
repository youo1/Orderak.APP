import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { api } from '@/shared/api/client';

export function FlagSimulator() {
  const [form, setForm] = useState({ flag_key: '', actor_key: '', country: '', app_version: '', plan: '', store_id: '' });
  const mutation = useMutation({ mutationFn: () => api<Record<string, unknown>>('/api/admin/v1/flags/evaluate', { method: 'POST', body: JSON.stringify({ ...form, app_version: form.app_version ? Number(form.app_version) : undefined }) }) });
  return <section className="panel spaced"><div className="panel-heading"><div><p className="eyebrow">EVALUATION SIMULATOR</p><h2>Test deterministic rollout</h2><p>Read-only: see which rule and hard gate would win for one actor.</p></div><FlaskConical /></div><div className="form-grid compact">{Object.keys(form).map(key => <label className="field" key={key}><span>{key.replaceAll('_', ' ')}</span><input value={form[key as keyof typeof form]} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></label>)}</div><button className="button" disabled={!form.flag_key || !form.actor_key || mutation.isPending} onClick={() => mutation.mutate()}>Evaluate</button>{mutation.data && <pre className="json-view compact">{JSON.stringify(mutation.data, null, 2)}</pre>}{mutation.error && <p className="error-text">{mutation.error.message}</p>}</section>;
}
