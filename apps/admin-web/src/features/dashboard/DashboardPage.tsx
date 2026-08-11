import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Headphones, ShieldAlert, ShoppingBag, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';

type Metric = Record<string, number>;
type Dashboard = { stores: Metric; buyers: Metric; subscriptions: Metric; support: Metric; deletions: Metric; security: Metric; sessions: Metric; generated_at: string };

export default function DashboardPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/admin/v1/control-plane/dashboard'), refetchInterval: 60_000 });
  if (query.isLoading) return <><PageHeader title="Dashboard" description="One operational view of Orderak." /><LoadingState /></>;
  if (query.error) return <><PageHeader title="Dashboard" description="One operational view of Orderak." /><ErrorState error={query.error} retry={() => query.refetch()} /></>;
  const data = query.data!;
  const urgent = Number(data.security.critical || 0) + Number(data.deletions.actionable || 0) + Number(data.support.high || 0);
  return <>
    <PageHeader title="Dashboard" description="Live platform health, seller growth and work requiring attention." actions={<span className="updated-label">Updated automatically</span>} />
    <div className="metric-grid">
      <MetricCard label="Stores" value={data.stores.total} detail={`${data.stores.active || 0} active`} icon={<Store />} href="/stores" />
      <MetricCard label="Customers" value={data.buyers.total} detail="Store-scoped profiles" icon={<ShoppingBag />} href="/buyers" />
      <MetricCard label="Open support" value={data.support.open} detail={`${data.support.high || 0} high priority`} icon={<Headphones />} href="/support" />
      <MetricCard label="Urgent alerts" value={urgent} detail={`${data.security.critical || 0} critical security`} icon={<ShieldAlert />} href="/system/security" danger={urgent > 0} />
    </div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Attention queue</h2></div></div><div className="attention-list">
      <Attention icon={<ShieldAlert />} label="Open security alerts" value={data.security.open || 0} href="/system/security" tone="danger" />
      <Attention icon={<AlertTriangle />} label="Deletion requests requiring action" value={data.deletions.actionable || 0} href="/deletions" tone="warning" />
      <Attention icon={<Headphones />} label="High-priority tickets" value={data.support.high || 0} href="/support" tone="neutral" />
    </div></section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">COMMERCIAL HEALTH</p><h2>Subscription snapshot</h2></div><Link to="/commerce/subscriptions">Open details <ArrowRight size={14} /></Link></div><dl className="snapshot"><div><dt>Active</dt><dd>{data.subscriptions.active || 0}</dd></div><div><dt>Grace</dt><dd>{data.subscriptions.grace || 0}</dd></div><div><dt>Total</dt><dd>{data.subscriptions.total || 0}</dd></div><div><dt>Admin sessions</dt><dd>{data.sessions.active || 0}</dd></div></dl></section></div>
    <section className="truth-banner"><ShieldAlert size={20} /><div><strong>Truthful control policy is active</strong><p>Deployment hard gates remain authoritative. Display-only and planned capabilities cannot be changed from this panel.</p></div><Link to="/governance/capabilities">Review registry</Link></section>
  </>;
}

function MetricCard({ label, value, detail, icon, href, danger }: { label: string; value: number; detail: string; icon: React.ReactNode; href: string; danger?: boolean }) { return <Link className={`metric-card ${danger ? 'danger' : ''}`} to={href}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{Number(value || 0).toLocaleString()}</strong><small>{detail}</small></div><ArrowRight size={17} /></Link>; }
function Attention({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: number; href: string; tone: string }) { return <Link to={href} className={`attention ${tone}`}><span>{icon}</span><strong>{label}</strong><em>{Number(value || 0)}</em><ArrowRight size={15} /></Link>; }
