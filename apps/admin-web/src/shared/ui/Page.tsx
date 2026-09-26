import { X } from 'lucide-react';
import { ApiError } from '@/shared/api/client';
import { Button } from './button';
import { humanize, StatusBadge } from './DataTable';

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">ADMIN CONTROL CENTER</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function LoadingState() { return <div className="state-card"><div className="ork-spinner" /><p>Loading current data…</p></div>; }

/**
 * A section that would not load — or will not open for this operator.
 *
 * A refusal is not a failure, and every section treated it as one. The panel
 * serves 176 admin operations behind four roles, and a page an operator's role
 * does not include rendered as "Could not load this section" with a Try again
 * button: a network-shaped problem, and a button that could not possibly fix it.
 * Nothing anywhere said "you may not", which is the one thing the operator
 * actually needed to know.
 *
 * The distinction costs nothing to make here: `api()` throws `ApiError` carrying
 * the HTTP status, and this is the single component every section renders its
 * query error through — nine feature pages, twelve call sites.
 *
 * No retry button on the refusal, deliberately. A 403 answers identically
 * however many times it is asked; offering Try again would be the same lie in a
 * smaller place.
 */
export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className="state-card">
        <h2>You don&apos;t have access to this section</h2>
        <p>
          Your administrator role does not include the permission this page needs, so there is nothing
          here for you to change. An owner can grant it in Admin access.
        </p>
      </div>
    );
  }
  return <div className="state-card error"><h2>Could not load this section</h2><p>{error.message}</p><Button variant="outline" onClick={retry}>Try again</Button></div>;
}

export function DetailPanel({ title, row, onClose, actions }: { title: string; row: Record<string, unknown>; onClose: () => void; actions?: React.ReactNode }) {
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><aside className="drawer" aria-label={`${title} details`}><header><div><p className="eyebrow">RECORD DETAIL</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button></header>{actions && <div className="drawer-actions">{actions}</div>}<dl>{Object.entries(row).filter(([key]) => !/password|secret|token|cipher/i.test(key)).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{/status|state|active|severity/i.test(key) ? <StatusBadge value={value} /> : typeof value === 'object' ? <pre>{JSON.stringify(value, null, 2)}</pre> : String(value ?? '—')}</dd></div>)}</dl></aside></div>;
}
