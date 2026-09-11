import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
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

  const requeue = useMutation({
    mutationFn: async () => {
      const id = String(selected?.id);
      // Bound to this job and this reason. The server checks the binding, so a
      // stale authorization cannot be replayed against a different job.
      const authorization = await api<{ authorization_id: string }>('/api/admin/v1/action-authorizations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'billing.verification_retry',
          entity_id: id,
          payload_hash: retry.reason,
          password: retry.password,
          totp_code: retry.totp,
        }),
      });
      return api(`/api/admin/v1/billing/verifications/${id}/retry`, {
        method: 'POST',
        headers: { 'x-admin-action-authorization': authorization.authorization_id },
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
      actions={<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button>}
    />

    <section className="truth-banner warning">
      <AlertTriangle />
      <div>
        <strong>A requeue re-runs verification; it never grants an entitlement directly</strong>
        <p>Google remains the authority on whether a purchase is valid. Requeuing only puts the job back in front of that check, and only a job the queue has already given up on can be requeued.</p>
      </div>
    </section>

    <div className="inline-form">
      <label className="field">
        <span>Status</span>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
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
        </select>
      </label>
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

    {selected && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true">
      <header>
        <div>
          <p className="eyebrow">VERIFICATION JOB</p>
          <h2>{String(selected.id)}</h2>
          <StatusBadge value={selected.status} />
        </div>
        <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close">×</button>
      </header>

      <pre className="json-view">{JSON.stringify(selected, null, 2)}</pre>

      {/* Said plainly rather than by disabling a button with no explanation:
          the server returns 409 verification_not_dead_lettered, and an operator
          reading a greyed-out control cannot tell that from a permission
          problem. */}
      {!deadLettered && <p className="error-text">Only a dead-lettered job can be requeued. This one is {String(selected.status)}, so the queue has not given up on it yet.</p>}

      {deadLettered && canManage && <div className="form-grid">
        <label className="field">
          <span>Audited reason</span>
          <textarea rows={3} value={retry.reason} onChange={event => setRetry(value => ({ ...value, reason: event.target.value }))} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={retry.password} onChange={event => setRetry(value => ({ ...value, password: event.target.value }))} />
        </label>
        <label className="field">
          <span>Fresh TOTP</span>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={retry.totp} onChange={event => setRetry(value => ({ ...value, totp: event.target.value.replace(/\D/g, '').slice(0, 6) }))} />
        </label>
      </div>}

      {requeue.error && <p className="error-text">{requeue.error.message}</p>}

      <footer>
        <button className="button" onClick={() => setSelected(null)}>Close</button>
        {deadLettered && canManage && <button
          className="button danger"
          disabled={retry.reason.trim().length < 5 || retry.password.length < 12 || retry.totp.length !== 6 || requeue.isPending}
          onClick={() => { if (confirm('Requeue this verification? The attempt and your reason are permanently audited.')) requeue.mutate(); }}
        ><RotateCcw size={16} /> {requeue.isPending ? 'Requeuing…' : 'Requeue verification'}</button>}
      </footer>
    </section></div>}
  </>;
}
