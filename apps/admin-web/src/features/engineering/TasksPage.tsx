import { useState } from 'react';
import { CanAccess, useCreate, useDelete, useList, useUpdate } from '@refinedev/core';
import { Plus, RefreshCw } from 'lucide-react';
import { DataTable } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NativeSelect, Textarea } from '@/shared/ui/textarea';
import { askConfirm } from '@/shared/ui/confirm';
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
          {auth.can('tasks:manage') && <Button onClick={() => setEditing({ ...emptyTask })}><Plus size={16} /> New task</Button>}
          <Button variant="outline" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</Button>
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
    if (!isEdit) return;
    askConfirm('Delete this task?', () => deleteOne.mutate({ resource: 'tasks', id: task.id! }, { onSuccess: close }), 'Delete task');
  };

  const set = (field: keyof typeof values) => (value: string) => setValues(current => ({ ...current, [field]: value }));

  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader>
          <p className="eyebrow">{isEdit ? 'EDIT TASK' : 'NEW TASK'}</p>
          <DialogTitle>{isEdit ? 'Edit task' : 'Add task'}</DialogTitle>
          <DialogDescription>Tasks are internal-only delivery records; every write goes through the audited admin API.</DialogDescription>
        </DialogHeader>
        <div className="form-grid">
          <Field label="Title *" className="wide"><Input value={values.title} onChange={event => set('title')(event.target.value)} /></Field>
          <Field label="Description" className="wide"><Textarea rows={4} value={values.description} onChange={event => set('description')(event.target.value)} /></Field>
          <Field label="Status"><NativeSelect value={values.status} onChange={event => set('status')(event.target.value)}>{STATUS_OPTIONS.map(option => <option key={option}>{option}</option>)}</NativeSelect></Field>
          <Field label="Priority"><NativeSelect value={values.priority} onChange={event => set('priority')(event.target.value)}>{PRIORITY_OPTIONS.map(option => <option key={option}>{option}</option>)}</NativeSelect></Field>
          <Field label="Assignee"><Input value={values.assigned_to} onChange={event => set('assigned_to')(event.target.value)} /></Field>
          <Field label="Related area"><Input value={values.related_area} onChange={event => set('related_area')(event.target.value)} /></Field>
        </div>
        {active.mutation.error && <p className="error-text">{active.mutation.error.message}</p>}
        <DialogFooter className="sm:justify-between">
          {isEdit ? <Button variant="destructive" disabled={deleteOne.mutation.isPending} onClick={remove}>{deleteOne.mutation.isPending ? 'Deleting…' : 'Delete'}</Button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!values.title.trim() || active.mutation.isPending} onClick={submit}>
              {active.mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add task'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
