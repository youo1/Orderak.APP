import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { askConfirm } from '@/shared/ui/confirm';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NativeSelect, Textarea } from '@/shared/ui/textarea';
import { STEP_UP_UNAVAILABLE, useStepUp } from '@/shared/api/step-up';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;

type Health = {
  queue_depth?: Record<string, unknown>;
  claim_leases?: Record<string, unknown>;
  provider_circuits?: unknown[];
};

/**
 * The Play purchase verification queue, and the one place a dead-lettered job
 * can be sent back.
 *
 * WHY THIS IS A PAGE AND NOT A ResourcePage
 *   The list would fit the generic resource shape. The retry does not: it
 *   requires a written reason, a fresh password-and-TOTP authorization bound to
 *   this exact job, and it 409s unless the job is genuinely dead-lettered. A
 *   generic action row can express none of those, and one that silently dropped
 *   the authorization would fail at the server with a message an operator could
 *   not act on.
 *
 * WHY IT EXISTS AT ALL
 *   docs/runbooks/play-billing-dlq.md describes recovering a failed purchase
 *   verification, and every step of it was a wrangler command. A purchase is
 *   real money already taken; the entitlement it should have granted is missing
 *   until someone requeues the job. Opening production billing without a way to
 *   do that in the console means the recovery path for a paying seller runs
 *   through a terminal.
 */
export function BillingVerificationsPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Row | null>(null);
  const [retry, setRetry] = useState({ reason: '', password: '', totp: '' });
  const [statusFilter, setStatusFilter] = useState('');

  const query = useQuery({
    queryKey: ['billing-verifications', statusFilter],
    queryFn: async () => {
      const path = statusFilter
        ? `/api/admin/v1/billing/verifications?status=${encodeURIComponent(statusFilter)}`
        : '/api/admin/v1/billing/verifications';
      const [verifications, health] = await Promise.all([
        api<{ verifications: Row[] }>(path),
        api<Health>('/api/admin/v1/billing/health'),
      ]);
      return { verifications: verifications.verifications ?? [], health };
    },
  });

  const stepUp = useStepUp();

  const requeue = useMutation({
    mutationFn: async () => {
      const id = String(selected?.id);
      // Bound to this job and this reason. The server checks the binding, so a
      // stale authorization cannot be replayed against a different job.
      const authorizationId = await stepUp.authorize('billing.verification_retry', id, retry.reason, retry.password, retry.totp);
      return api(`/api/admin/v1/billing/verifications/${id}/retry`, {
        method: 'POST',
        headers: { 'x-admin-action-authorization': authorizationId },
        body: JSON.stringify({ reason: retry.reason }),
      });
    },
    onSuccess: () => {
      setSelected(null);
      setRetry({ reason: '', password: '', totp: '' });
      client.invalidateQueries({ queryKey: ['billing-verifications'] });
    },
  });

  const deadLettered = selected?.status === 'dead_lettered';
  const canManage = auth.can('subscriptions:manage');

  return <>
    <PageHeader
      title="Purchase verification queue"
      description="Play purchase verification jobs, lease state and audited requeues of dead-lettered work."
      actions={<Button variant="outline" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</Button>}
    />

    <section className="truth-banner warning">
      <AlertTriangle />
      <div>
        <strong>A requeue re-runs verification; it never grants an entitlement directly</strong>
        <p>Google remains the authority on whether a purchase is valid. Requeuing only puts the job back in front of that check, and only a job the queue has already given up on can be requeued.</p>
      </div>
    </section>

    <div className="inline-form">
      <Field label="Status">
        <NativeSelect value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">All</option>
          {/* The column's own CHECK constraint, in migration 030. A value not in
              this set returns an empty list rather than an error, which would
              read as "no failures" — the most misleading possible answer here. */}
          <option value="queued">queued</option>
          <option value="processing">processing</option>
          <option value="retrying">retrying</option>
          <option value="applied_ack_pending">applied_ack_pending</option>
          <option value="succeeded">succeeded</option>
          <option value="terminal_failed">terminal_failed</option>
          <option value="superseded">superseded</option>
          <option value="dead_lettered">dead_lettered</option>
        </NativeSelect>
      </Field>
    </div>

    {query.isLoading && <LoadingState />}
    {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
    {query.data && <>
      <section className="resource-group">
        <div className="section-heading"><h2>Queue health</h2></div>
        <pre className="json-view">{JSON.stringify(query.data.health, null, 2)}</pre>
      </section>
      <section className="resource-group">
        <div className="section-heading"><h2>Verification jobs</h2><span>{query.data.verifications.length}</span></div>
        <DataTable
          rows={query.data.verifications}
          onSelect={setSelected}
          preferred={['id', 'status', 'purchase_status', 'attempt_count', 'error_code', 'next_attempt_at', 'claim_expires_at', 'requeued_from_job_id', 'created_at']}
        />
      </section>
    </>}

    {selected && <Dialog open onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader>
          <div>
            <p className="eyebrow">VERIFICATION JOB</p>
            <DialogTitle>{String(selected.id)}</DialogTitle>
            <StatusBadge value={selected.status} />
          </div>
        </DialogHeader>

        <pre className="json-view">{JSON.stringify(selected, null, 2)}</pre>

        {/* Said plainly rather than by disabling a button with no explanation:
            the server returns 409 verification_not_dead_lettered, and an operator
            reading a greyed-out control cannot tell that from a permission
            problem. */}
        {!deadLettered && <p className="error-text">Only a dead-lettered job can be requeued. This one is {String(selected.status)}, so the queue has not given up on it yet.</p>}

        {deadLettered && canManage && <div className="form-grid">
          <Field label="Audited reason">
            <Textarea rows={3} value={retry.reason} onChange={event => setRetry(value => ({ ...value, reason: event.target.value }))} />
          </Field>
          {stepUp.available ? <><Field label="Password">
            <Input type="password" autoComplete="current-password" value={retry.password} onChange={event => setRetry(value => ({ ...value, password: event.target.value }))} />
          </Field>
          <Field label="Fresh TOTP">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={retry.totp} onChange={event => setRetry(value => ({ ...value, totp: event.target.value.replace(/\D/g, '').slice(0, 6) }))} />
          </Field></> : <p className="error-text wide">{STEP_UP_UNAVAILABLE}</p>}
        </div>}

        {requeue.error && <p className="error-text">{requeue.error.message}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
          {deadLettered && canManage && <Button
            variant="destructive"
            disabled={!stepUp.available || retry.reason.trim().length < 5 || retry.password.length < 12 || retry.totp.length !== 6 || requeue.isPending}
            onClick={() => { askConfirm('Requeue this verification? The attempt and your reason are permanently audited.', () => requeue.mutate()); }}
          ><RotateCcw size={16} /> {requeue.isPending ? 'Requeuing…' : 'Requeue verification'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
}
