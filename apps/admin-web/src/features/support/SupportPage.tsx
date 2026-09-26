import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquareReply, RefreshCw } from 'lucide-react';
import { api, format } from '@/shared/api/client';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field } from '@/shared/ui/field';
import { NativeSelect, Textarea } from '@/shared/ui/textarea';
import { useAuth } from '@/features/auth/auth-context';

type Row = Record<string, unknown>;

export function SupportPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['support'], queryFn: () => api<{ tickets: Row[] }>('/api/admin/v1/support/tickets') });
  return <><PageHeader title="Support" description="A focused queue for assignment, priority and threaded seller replies." actions={<Button variant="outline" onClick={() => query.refetch()}><RefreshCw size={16} /> Refresh</Button>} />{query.isLoading && <LoadingState />}{query.error && <ErrorState error={query.error} retry={() => query.refetch()} />}{query.data && <DataTable rows={query.data.tickets} onSelect={row => navigate(`/support/${row.id}`)} preferred={['id', 'subject', 'store_name', 'status', 'priority', 'assigned_email', 'updated_at']} />}</>;
}

export function TicketDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('normal');
  const query = useQuery({ queryKey: ['ticket', id], queryFn: () => api<{ ticket: Row; messages: Row[] }>(`/api/admin/v1/support/tickets/${id}`) });
  const update = useMutation({ mutationFn: () => api(`/api/admin/v1/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status, priority, assigned_to: auth.admin?.id }) }), onSuccess: () => client.invalidateQueries({ queryKey: ['ticket', id] }) });
  const reply = useMutation({ mutationFn: () => api(`/api/admin/v1/support/tickets/${id}`, { method: 'POST', body: JSON.stringify({ message }) }), onSuccess: () => { setMessage(''); client.invalidateQueries({ queryKey: ['ticket', id] }); } });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const { ticket, messages } = query.data!;
  return <><Link className="back-link" to="/support"><ArrowLeft size={15} /> Back to support</Link><PageHeader title={String(ticket.subject)} description={`Ticket #${ticket.id} · ${format.date(ticket.created_at, auth.admin?.timezone)}`} actions={<><StatusBadge value={ticket.priority} /><StatusBadge value={ticket.status} /></>} />
    <div className="ticket-layout"><section className="conversation">{messages.map(item => <article key={String(item.id)} className={`message ${item.sender === 'admin' ? 'admin' : 'seller'}`}><header><strong>{item.sender === 'admin' ? 'Orderak support' : 'Seller'}</strong><time>{format.date(item.created_at, auth.admin?.timezone)}</time></header><p>{String(item.body)}</p></article>)}{!messages.length && <div className="empty-state">No messages yet</div>}
    {auth.can('support:manage') && <form className="reply-box" onSubmit={event => { event.preventDefault(); reply.mutate(); }}><Field label="Reply"><Textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Write a clear response…" rows={5} /></Field><Button className="justify-self-end" disabled={!message.trim() || reply.isPending}><MessageSquareReply size={16} /> {reply.isPending ? 'Sending…' : 'Send reply'}</Button></form>}</section>
    <aside className="ticket-sidebar"><Card><CardHeader><CardTitle>Workflow</CardTitle></CardHeader><CardContent className="grid gap-3"><Field label="Status"><NativeSelect value={status} onChange={event => setStatus(event.target.value)}><option>open</option><option>pending</option><option>closed</option></NativeSelect></Field><Field label="Priority"><NativeSelect value={priority} onChange={event => setPriority(event.target.value)}><option>low</option><option>normal</option><option>high</option></NativeSelect></Field><Button variant="outline" className="w-full" onClick={() => update.mutate()} disabled={update.isPending}>Assign to me & update</Button></CardContent></Card><Card><CardHeader><CardTitle>Ticket data</CardTitle></CardHeader><CardContent><pre className="json-view compact">{JSON.stringify(ticket, null, 2)}</pre></CardContent></Card></aside></div>
  </>;
}
