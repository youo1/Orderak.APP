import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppShell } from '@/app/layout/AppShell';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { useAuth } from '@/features/auth/auth-context';
import { AccountSecurityGate } from '@/features/auth/AccountSecurityGate';
import DashboardPage from '@/features/dashboard/DashboardPage';
import { StoresPage, StoreDetailPage } from '@/features/stores/StoresPage';
import { SupportPage, TicketDetailPage } from '@/features/support/SupportPage';
import { RuntimePage } from '@/features/governance/RuntimePage';
import { ResourcePage } from '@/features/resources/ResourcePage';
import { AdminAccessPage, DeletionsPage, JobsPage, SecurityPage } from '@/features/operations/OperationsPages';
import { FlagSimulator } from '@/features/governance/FlagSimulator';
import { PlansPage } from '@/features/commerce/PlansPage';
import { sections, sectionById } from '@/app/config/sections';

const ThemeBuilderPage = lazy(() => import('@/features/theme/ThemeBuilderPage'));

export default function App() {
  const auth = useAuth();
  if (auth.loading) return <div className="splash"><div className="brand-mark">O</div><div className="spinner" /><span>Securing session…</span></div>;
  if (!auth.admin || auth.loginState === 'recovery-codes') return <LoginScreen />;
  if (auth.admin.mustChangePassword) return <AccountSecurityGate />;
  return <Routes><Route element={<AppShell />}>
    <Route index element={<DashboardPage />} />
    <Route path="stores" element={<Permission permission="sellers:view"><StoresPage /></Permission>} />
    <Route path="stores/:id" element={<Permission permission="sellers:view"><StoreDetailPage /></Permission>} />
    <Route path="support" element={<Permission permission="support:view"><SupportPage /></Permission>} />
    <Route path="support/:id" element={<Permission permission="support:view"><TicketDetailPage /></Permission>} />
    <Route path="deletions" element={<Permission permission="deletions:view"><DeletionsPage /></Permission>} />
    <Route path="governance/runtime" element={<Permission permission="settings:view"><RuntimePage /></Permission>} />
    <Route path="system/jobs" element={<Permission permission="operations:view"><JobsPage /></Permission>} />
    <Route path="system/security" element={<Permission permission="security:view"><SecurityPage /></Permission>} />
    <Route path="system/access" element={<Permission permission="admins:view"><AdminAccessPage /></Permission>} />
    <Route path="commerce/plans" element={<Permission permission="plans:view"><PlansPage /></Permission>} />
    <Route path="system/theme" element={<Permission permission="theme:view"><Suspense fallback={<div className="page">Loading theme builder…</div>}><ThemeBuilderPage /></Suspense></Permission>} />
    {sections.filter(section => !['dashboard', 'stores', 'support', 'deletions', 'runtime', 'jobs', 'security', 'admins', 'plans', 'theme'].includes(section.id)).map(section => <Route key={section.id} path={section.path.slice(1)} element={<Permission permission={section.permission}><ResourcePage section={section} />{section.id === 'flags' && <FlagSimulator />}</Permission>} />)}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function Permission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth.can(permission)) return <Navigate to="/" replace />;
  return children;
}

void sectionById;
