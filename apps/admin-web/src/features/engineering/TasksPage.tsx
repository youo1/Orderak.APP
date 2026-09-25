import { useState } from 'react';
import { CanAccess, useCreate, useDelete, useList, useUpdate } from '@refinedev/core';
import { Plus, RefreshCw, X } from 'lucide-react';
import { DataTable } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { sectionById } from '@/app/config/sections';
import { useAuth } from '@/features/auth/auth-context';

const section = sectionById.tasks;
const PREFERRED_COLUMNS = ['id', 'title', 'status', 'priority', 'assigned_to', 'related_area', 'updated_at'];
const STATUS_OPTIONS = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical'];

type Task = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  related_area: string | null;
};

const emptyTask: Partial<Task> = { title: '', description: '', status: 'todo', priority: 'medium', assigned_to: '', related_area: '' };

/**
 * Phase 2 pilot (Refine install plan): the first write-capable resource,
 * proving `create`/`update`/`delete` through the real data provider —
 * `audit` (Phase 1) only proved `getList`. Tasks was picked because it's
 * internal-only (no customer/financial data) and its backend route
 * (admin-project.ts) genuinely supports all three operations, unlike some
 * sections whose "manage" endpoint is really a single upsert.
 *
 * This retires `actions.ts`'s `tasks` entry and the generic `ActionDialog`
 * create form for this resource — there is exactly one path to create or
 * edit a task now, not two.
 */
export function TasksPage() {
  const auth = useAuth();
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const { result, query } = useList<Task>({ resource: 'tasks', pagination: { mode: 'off' } });

  return (
    <CanAccess resource="tasks" action="list">
      <PageHeader
        title={section.label}
        description={section.description}
        actions={<>
          {auth.can('tasks:manage') && <button className="button primary" onClick={() => setEditing({ ...emptyTask })}><Plus size={16} /> New task</button>}
          <button className="button" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</button>
        </>}
      />
      {query.isLoading && <LoadingState />}
      {query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}
      {!query.isLoading && !query.error && (
        <DataTable rows={result.data} onSelect={row => setEditing(row as Task)} preferred={PREFERRED_COLUMNS} />
      )}
      {editing && <TaskForm task={editing} close={() => setEditing(null)} />}
    </CanAccess>
  );
}

function TaskForm({ task, close }: { task: Partial<Task>; close: () => void }) {
  const isEdit = typeof task.id === 'number';
  const [values, setValues] = useState({
    title: task.title ?? '',
    description: task.description ?? '',
    status: task.status ?? 'todo',
    priority: task.priority ?? 'medium',
    assigned_to: task.assigned_to ?? '',
    related_area: task.related_area ?? '',
  });
  const create = useCreate();
  const update = useUpdate();
  const deleteOne = useDelete();
  const active = isEdit ? update : create;

  const submit = () => {
    if (isEdit) update.mutate({ resource: 'tasks', id: task.id!, values }, { onSuccess: close });
    else create.mutate({ resource: 'tasks', values }, { onSuccess: close });
  };

  const remove = () => {
    if (!isEdit || !confirm('Delete this task?')) return;
    deleteOne.mutate({ resource: 'tasks', id: task.id! }, { onSuccess: close });
  };

  const set = (field: keyof typeof values) => (value: string) => setValues(current => ({ ...current, [field]: value }));

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}>
      <section className="modal" role="dialog" aria-modal="true">
        <header>
          <div><p className="eyebrow">{isEdit ? 'EDIT TASK' : 'NEW TASK'}</p><h2>{isEdit ? 'Edit task' : 'Add task'}</h2></div>
          <button className="icon-button" onClick={close} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="form-grid">
          <label className="field wide"><span>Title *</span><input value={values.title} onChange={event => set('title')(event.target.value)} /></label>
          <label className="field wide"><span>Description</span><textarea rows={4} value={values.description} onChange={event => set('description')(event.target.value)} /></label>
          <label className="field"><span>Status</span><select value={values.status} onChange={event => set('status')(event.target.value)}>{STATUS_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
          <label className="field"><span>Priority</span><select value={values.priority} onChange={event => set('priority')(event.target.value)}>{PRIORITY_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
          <label className="field"><span>Assignee</span><input value={values.assigned_to} onChange={event => set('assigned_to')(event.target.value)} /></label>
          <label className="field"><span>Related area</span><input value={values.related_area} onChange={event => set('related_area')(event.target.value)} /></label>
        </div>
        {active.mutation.error && <p className="error-text">{active.mutation.error.message}</p>}
        <footer>
          {isEdit && <button className="button danger" disabled={deleteOne.mutation.isPending} onClick={remove}>{deleteOne.mutation.isPending ? 'Deleting…' : 'Delete'}</button>}
          <button className="button" onClick={close}>Cancel</button>
          <button className="button primary" disabled={!values.title.trim() || active.mutation.isPending} onClick={submit}>
            {active.mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add task'}
          </button>
        </footer>
      </section>
    </div>
  );
}
