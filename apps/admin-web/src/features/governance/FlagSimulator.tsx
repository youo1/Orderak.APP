import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

export function FlagSimulator() {
  const [form, setForm] = useState({ flag_key: '', actor_key: '', country: '', app_version: '', plan: '', store_id: '' });
  const mutation = useMutation({ mutationFn: () => api<Record<string, unknown>>('/api/admin/v1/flags/evaluate', { method: 'POST', body: JSON.stringify({ ...form, app_version: form.app_version ? Number(form.app_version) : undefined }) }) });
  return <Card className="mt-5"><CardHeader><p className="eyebrow">EVALUATION SIMULATOR</p><CardTitle>Test deterministic rollout</CardTitle><CardDescription>Read-only: see which rule and hard gate would win for one actor.</CardDescription></CardHeader><CardContent><div className="form-grid compact">{Object.keys(form).map(key => <Field label={key.replaceAll('_', ' ')} key={key}><Input value={form[key as keyof typeof form]} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></Field>)}</div><Button variant="outline" disabled={!form.flag_key || !form.actor_key || mutation.isPending} onClick={() => mutation.mutate()}>Evaluate</Button>{mutation.data && <pre className="json-view compact">{JSON.stringify(mutation.data, null, 2)}</pre>}{mutation.error && <p className="error-text">{mutation.error.message}</p>}</CardContent></Card>;
}
