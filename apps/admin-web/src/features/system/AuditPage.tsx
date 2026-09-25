import { useState } from 'react';
import { CanAccess, useList } from '@refinedev/core';
import { RefreshCw } from 'lucide-react';
import { DataTable } from '@/shared/ui/DataTable';
import { DetailPanel, ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { sectionById } from '@/app/config/sections';

const section = sectionById.audit;
const PREFERRED_COLUMNS = ['id', 'admin_email', 'action', 'entity', 'entity_id', 'ip', 'created_at'];

/**
 * Phase 1 pilot migration (see the Refine install plan): the first section
 * moved off the generic `ResourcePage` onto Refine's `useList`, reusing the
 * existing `DataTable`/`Page` primitives unchanged. `useList` (not
 * `useTable`) because `DataTable` already does its own client-side
 * search/pagination over a full row array — adding Refine's table-level
 * pagination on top would just be a second, redundant layer for this
 * specific component.
 *
 * `<CanAccess>` here is UI visibility only, replacing the route-level
 * `<Permission>` wrapper for this one resource: the Admin Worker still
 * re-checks `audit:view` on every request regardless of what this renders.
 */
export function AuditPage() {
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const { result, query } = useList({ resource: 'audit', pagination: { mode: 'off' } });

  return (
    <CanAccess resource="audit" action="list">
      <PageHeader
        title={section.label}
        description={section.description}
        actions={<button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button>}
      />
      {query.isLoading && <LoadingState />}
      {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
      {!query.isLoading && !query.error && (
        <DataTable rows={result.data} onSelect={setSelected} preferred={PREFERRED_COLUMNS} />
      )}
      {selected && (
        <DetailPanel title={String(selected.id ?? 'Audit entry')} row={selected} onClose={() => setSelected(null)} />
      )}
    </CanAccess>
  );
}
