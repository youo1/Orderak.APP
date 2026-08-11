import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/shared/api/client';
import type { ActionConfig, Field } from '@/app/config/actions';

export function ActionDialog({ config, resourceKey, close }: { config: ActionConfig; resourceKey: string; close: () => void }) {
  const client = useQueryClient();
  const initial = useMemo(() => Object.fromEntries(config.fields.map(field => [field.name, field.defaultValue ?? (field.type === 'checkbox' ? false : '')])), [config]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [freshPassword, setFreshPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const sensitiveExport = resourceKey === 'exports' && values.classification === 'sensitive';
  const mutation = useMutation({ mutationFn: async () => {
    const payload = serialize(config.fields, values);
    const endpoint = config.pathField ? `${config.endpoint}/${encodeURIComponent(String(payload[config.pathField] ?? ''))}` : config.endpoint;
    if (config.pathField) delete payload[config.pathField];
    const headers = new Headers();
    if (sensitiveExport) {
      const authorization = await api<{ authorization_id: string }>('/api/admin/v1/action-authorizations', { method: 'POST', body: JSON.stringify({ action: 'export.sensitive', entity_id: String(payload.export_type), payload_hash: 'export-request', password: freshPassword, totp_code: totpCode }) });
      headers.set('x-admin-action-authorization', authorization.authorization_id);
    }
    return api(endpoint, { method: config.method || 'POST', headers, body: JSON.stringify(payload) });
  }, onSuccess: () => { client.invalidateQueries({ queryKey: ['resource', resourceKey] }); close(); } });
  const valid = config.fields.filter(field => field.required).every(field => String(values[field.name] ?? '').trim()) && (!sensitiveExport || (freshPassword.length >= 12 && /^\d{6}$/.test(totpCode)));
  return <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><section className="modal" role="dialog" aria-modal="true"><header><div><p className="eyebrow">AUDITED ACTION</p><h2>{config.label}</h2><p>{config.description}</p></div><button className="icon-button" onClick={close} aria-label="Close"><X size={18} /></button></header><div className="form-grid">{config.fields.map(field => <FormField field={field} value={values[field.name]} set={value => setValues(current => ({ ...current, [field.name]: value }))} key={field.name} />)}{sensitiveExport && <><label className="field"><span>Owner password *</span><input type="password" autoComplete="current-password" value={freshPassword} onChange={event => setFreshPassword(event.target.value)} /></label><label className="field"><span>Fresh TOTP *</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label></>}</div>{mutation.error && <p className="error-text">{mutation.error.message}</p>}<footer><button className="button" onClick={close}>Cancel</button><button className="button primary" disabled={!valid || mutation.isPending} onClick={() => { if (!config.confirm || confirm(config.confirm)) mutation.mutate(); }}>{mutation.isPending ? 'Applying…' : config.label}</button></footer></section></div>;
}

function FormField({ field, value, set }: { field: Field; value: unknown; set: (value: unknown) => void }) {
  if (field.type === 'checkbox') return <label className="checkbox-field"><input type="checkbox" checked={Boolean(value)} onChange={event => set(event.target.checked)} /><span><strong>{field.label}</strong></span></label>;
  return <label className={`field ${field.type === 'textarea' ? 'wide' : ''}`}><span>{field.label}{field.required && ' *'}</span>{field.type === 'select' ? <select value={String(value)} onChange={event => set(event.target.value)}>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea rows={4} value={String(value)} placeholder={field.placeholder} onChange={event => set(event.target.value)} /> : <input type={field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : 'text'} value={String(value)} placeholder={field.placeholder} onChange={event => set(field.type === 'number' ? event.target.valueAsNumber : event.target.value)} />}</label>;
}

function serialize(fields: Field[], values: Record<string, unknown>) {
  const result = { ...values };
  for (const field of fields) {
    const value = result[field.name];
    if (field.name === 'blocked_version_codes' || field.name === 'value') {
      if (typeof value === 'string' && (value.trim().startsWith('[') || value.trim().startsWith('{'))) { try { result[field.name] = JSON.parse(value); } catch { /* backend validation reports malformed text */ } }
    }
    if (value === '') delete result[field.name];
  }
  return result;
}
