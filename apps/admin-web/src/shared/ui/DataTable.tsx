/* eslint-disable react/only-export-components */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

type Row = Record<string, unknown>;

const sensitive = /password|secret|token|cipher|raw_json|details_json|phone_hash|credential/i;

export function DataTable({ rows, onSelect, preferred = [] }: { rows: Row[]; onSelect?: (row: Row) => void; preferred?: string[] }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const columns = useMemo(() => {
    const keys = rows[0] ? Object.keys(rows[0]).filter(key => !sensitive.test(key)) : [];
    return [...preferred.filter(key => keys.includes(key)), ...keys.filter(key => !preferred.includes(key))].slice(0, 7);
  }, [rows, preferred]);
  const filtered = useMemo(() => !query ? rows : rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamped, not trusted. `page` only ever resets when the filter box changes,
  // so a refresh that returns fewer rows — or a row being deleted — left the
  // table on a page past the end, showing "No matching records" over data that
  // was there. Deriving the page from the current row count instead of storing
  // it means the state cannot outlive what it indexes.
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return <div className="table-card">
    <div className="table-tools"><label className="search-box"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Filter these results" /></label><span>{filtered.length.toLocaleString()} records</span></div>
    <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>
      {!visible.length && <tr><td colSpan={Math.max(1, columns.length)}><div className="empty-state">No matching records</div></td></tr>}
      {visible.map((row, index) => <tr key={String(row.id ?? row.flag_key ?? row.capability_key ?? index)} onClick={() => onSelect?.(row)} className={onSelect ? 'clickable' : ''}>{columns.map(column => <td key={column}>{renderValue(column, row[column])}</td>)}</tr>)}
    </tbody></table></div>
    <div className="pagination"><span>Page {safePage + 1} of {pageCount}</span><div><button aria-label="Previous page" disabled={!safePage} onClick={() => setPage(Math.max(0, safePage - 1))}><ChevronLeft size={16} /></button><button aria-label="Next page" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}><ChevronRight size={16} /></button></div></div>
  </div>;
}

/**
 * Status words, matched whole rather than as substrings.
 *
 * The tone used to come from `/active|…/i.test(text)`, and "inactive" contains
 * "active" — so every inactive, unavailable and unpublished row was painted
 * green, which is the one thing a status colour exists to prevent. Set
 * membership on the whole value cannot do that.
 */
const TONES: Record<string, 'positive' | 'negative' | 'warning'> = {
  active: 'positive', published: 'positive', reviewed: 'positive', succeeded: 'positive',
  completed: 'positive', enforced: 'positive', available: 'positive', open: 'positive',
  verified: 'positive', processed: 'positive', sent: 'positive',
  failed: 'negative', banned: 'negative', critical: 'negative', rejected: 'negative',
  blocked: 'negative', expired: 'negative', error: 'negative', revoked: 'negative',
  inactive: 'negative', unavailable: 'negative', suspended: 'negative', canceled: 'negative',
  cancelled: 'negative', dead_lettered: 'negative',
  pending: 'warning', grace: 'warning', draft: 'warning', warning: 'warning',
  display_only: 'warning', acknowledged: 'warning', queued: 'warning', retrying: 'warning',
  planned: 'warning', past_due: 'warning',
};

export function StatusBadge({ value }: { value: unknown }) {
  const text = String(value ?? 'unknown');
  const tone = TONES[text.trim().toLowerCase()] ?? 'neutral';
  return <span className={`status ${tone}`}>{text.replaceAll('_', ' ')}</span>;
}

function renderValue(key: string, value: unknown) {
  if (/status|state|severity|active|implementation/i.test(key)) return <StatusBadge value={typeof value === 'number' ? value ? 'active' : 'inactive' : value} />;
  if (value == null || value === '') return <span className="muted">—</span>;
  if (typeof value === 'object') return <code className="cell-code">{JSON.stringify(value)}</code>;
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

export function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()); }
