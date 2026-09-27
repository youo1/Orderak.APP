import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STEP_UP_UNAVAILABLE, useStepUp } from '@/shared/api/step-up';
import { Button } from '@/shared/ui/button';
import { askConfirm } from '@/shared/ui/confirm';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NativeSelect, Textarea } from '@/shared/ui/textarea';
import type { ActionConfig, Field as ActionField } from '@/app/config/actions';

export function ActionDialog({ config, resourceKey, close, onSuccess }: { config: ActionConfig; resourceKey: string; close: () => void; onSuccess?: () => void }) {
  const client = useQueryClient();
  const stepUp = useStepUp();
  const initial = useMemo(() => Object.fromEntries(config.fields.map(field => [field.name, field.defaultValue ?? (field.type === 'checkbox' ? false : '')])), [config]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [freshPassword, setFreshPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const sensitiveExport = resourceKey === 'exports' && values.classification === 'sensitive';
  // The step-up this dialog collects credentials for is owner-only, and the rule
  // lives in one place — see `shared/api/step-up.ts`. Credentials are not
  // collected at all when they could not be used.
  const stepUpBlocked = sensitiveExport && !stepUp.available;
  const mutation = useMutation({ mutationFn: async () => {
    const payload = serialize(config.fields, values);
    const endpoint = config.pathField ? `${config.endpoint}/${encodeURIComponent(String(payload[config.pathField] ?? ''))}` : config.endpoint;
    if (config.pathField) delete payload[config.pathField];
    const headers = new Headers();
    if (sensitiveExport) {
      const authorizationId = await stepUp.authorize('export.sensitive', String(payload.export_type), 'export-request', freshPassword, totpCode);
      headers.set('x-admin-action-authorization', authorizationId);
    }
    return api(endpoint, { method: config.method || 'POST', headers, body: JSON.stringify(payload) });
  }, onSuccess: () => { client.invalidateQueries({ queryKey: ['resource', resourceKey] }); onSuccess?.(); close(); } });
  const valid = config.fields.filter(field => field.required).every(field => String(values[field.name] ?? '').trim()) && !stepUpBlocked && (!sensitiveExport || (freshPassword.length >= 12 && /^\d{6}$/.test(totpCode)));
  // Radix `Dialog`, like the confirmation dialog beside it. This was the second
  // of five hand-rolled `div.modal-backdrop` layers: no focus trap, no scroll
  // lock, and an `aria-modal` it asserted about itself rather than implemented.
  // The close cross now comes from `DialogContent`, so the one here — and the
  // `icon-button` class it needed — are gone.
  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader>
          <p className="eyebrow">AUDITED ACTION</p>
          <DialogTitle>{config.label}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <div className="form-grid">
          {config.fields.map(field => <FormField field={field} value={values[field.name]} set={value => setValues(current => ({ ...current, [field.name]: value }))} key={field.name} />)}
          {sensitiveExport && stepUp.available && <><Field label="Owner password *"><Input type="password" autoComplete="current-password" value={freshPassword} onChange={event => setFreshPassword(event.target.value)} /></Field><Field label="Fresh TOTP *"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field></>}
        </div>
        {stepUpBlocked && <p className="error-text">{STEP_UP_UNAVAILABLE}</p>}
        {mutation.error && <p className="error-text">{mutation.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => { if (!config.confirm) mutation.mutate(); else askConfirm(config.confirm, () => mutation.mutate()); }}>{mutation.isPending ? 'Applying…' : config.label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({ field, value, set }: { field: ActionField; value: unknown; set: (value: unknown) => void }) {
  if (field.type === 'checkbox') return <label className="checkbox-field"><input type="checkbox" checked={Boolean(value)} onChange={event => set(event.target.checked)} /><span><strong>{field.label}</strong></span></label>;
  return <Field label={<>{field.label}{field.required && ' *'}</>} className={field.type === 'textarea' ? 'wide' : undefined}>{field.type === 'select' ? <NativeSelect value={String(value)} onChange={event => set(event.target.value)}>{field.options?.map(option => <option key={option}>{option}</option>)}</NativeSelect> : field.type === 'textarea' ? <Textarea rows={4} value={String(value)} placeholder={field.placeholder} onChange={event => set(event.target.value)} /> : <Input type={field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : 'text'} value={String(value)} placeholder={field.placeholder} onChange={event => set(field.type === 'number' ? event.target.valueAsNumber : event.target.value)} />}</Field>;
}

function serialize(fields: ActionField[], values: Record<string, unknown>) {
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
