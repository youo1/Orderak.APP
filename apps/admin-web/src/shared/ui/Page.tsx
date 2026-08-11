import { X } from 'lucide-react';
import { humanize, StatusBadge } from './DataTable';

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">ADMIN CONTROL CENTER</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function LoadingState() { return <div className="state-card"><div className="spinner" /><p>Loading current data…</p></div>; }
export function ErrorState({ error, retry }: { error: Error; retry: () => void }) { return <div className="state-card error"><h2>Could not load this section</h2><p>{error.message}</p><button className="button" onClick={retry}>Try again</button></div>; }

export function DetailPanel({ title, row, onClose, actions }: { title: string; row: Record<string, unknown>; onClose: () => void; actions?: React.ReactNode }) {
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><aside className="drawer" aria-label={`${title} details`}><header><div><p className="eyebrow">RECORD DETAIL</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button></header>{actions && <div className="drawer-actions">{actions}</div>}<dl>{Object.entries(row).filter(([key]) => !/password|secret|token|cipher/i.test(key)).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{/status|state|active|severity/i.test(key) ? <StatusBadge value={value} /> : typeof value === 'object' ? <pre>{JSON.stringify(value, null, 2)}</pre> : String(value ?? '—')}</dd></div>)}</dl></aside></div>;
}
