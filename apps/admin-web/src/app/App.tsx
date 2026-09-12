import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, type ComponentType } from 'react';
import { AppShell } from '@/app/layout/AppShell';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { useAuth } from '@/features/auth/auth-context';
import { AccountSecurityGate } from '@/features/auth/AccountSecurityGate';
import DashboardPage from '@/features/dashboard/DashboardPage';
import { ResourcePage } from '@/features/resources/ResourcePage';
import { sections, sectionById } from '@/app/config/sections';

// Eager above, lazy below.
//
// Eager is the shell an administrator always needs: the login screen, the
// security gate, the chrome, the dashboard they land on, and ResourcePage,
// which backs every generically-configured section at once and so is reachable
// from most of the navigation.
//
// Everything below is a destination someone navigates to, and typically one of
// them per session — so it does not belong in the chunk that has to parse before
// the login form can paint. ThemeBuilderPage was already split this way; this
// applies the same treatment to the rest.
//
// These modules export named components rather than defaults, so each import is
// mapped to the { default } shape lazy() requires.
const StoresPage = lazyNamed(() => import('@/features/stores/StoresPage'), 'StoresPage');
const StoreDetailPage = lazyNamed(() => import('@/features/stores/StoresPage'), 'StoreDetailPage');
const SupportPage = lazyNamed(() => import('@/features/support/SupportPage'), 'SupportPage');
const TicketDetailPage = lazyNamed(() => import('@/features/support/SupportPage'), 'TicketDetailPage');
const RuntimePage = lazyNamed(() => import('@/features/governance/RuntimePage'), 'RuntimePage');
const FlagSimulator = lazyNamed(() => import('@/features/governance/FlagSimulator'), 'FlagSimulator');
const AdminAccessPage = lazyNamed(() => import('@/features/operations/OperationsPages'), 'AdminAccessPage');
const DeletionsPage = lazyNamed(() => import('@/features/operations/OperationsPages'), 'DeletionsPage');
const JobsPage = lazyNamed(() => import('@/features/operations/OperationsPages'), 'JobsPage');
const SecurityPage = lazyNamed(() => import('@/features/operations/OperationsPages'), 'SecurityPage');
const PlansPage = lazyNamed(() => import('@/features/commerce/PlansPage'), 'PlansPage');
const BillingVerificationsPage = lazyNamed(() => import('@/features/commerce/BillingVerificationsPage'), 'BillingVerificationsPage');
const ThemeBuilderPage = lazy(() => import('@/features/theme/ThemeBuilderPage'));

/** lazy() for a module that exports the component under a name, not as default. */
function lazyNamed<K extends string>(
  load: () => Promise<Record<K, ComponentType<Record<string, never>>>>,
  name: K,
) {
  return lazy(async () => ({ default: (await load())[name] }));
}

export default function App() {
  const auth = useAuth();
  if (auth.loading) return <div className="splash"><div className="brand-mark">O</div><div className="ork-spinner" /><span>Securing session…</span></div>;
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
    <Route path="commerce/billing-verifications" element={<Permission permission="subscriptions:view"><BillingVerificationsPage /></Permission>} />
    {/* No local Suspense any more: AppShell wraps the outlet in one boundary
        now that every routed page is split, and a nested one here would give
        the theme builder a different loading state to everything else. */}
    <Route path="system/theme" element={<Permission permission="theme:view"><ThemeBuilderPage /></Permission>} />
    {sections.filter(section => !['dashboard', 'stores', 'support', 'deletions', 'runtime', 'jobs', 'security', 'admins', 'plans', 'theme', 'billing-verifications'].includes(section.id)).map(section => <Route key={section.id} path={section.path.slice(1)} element={<Permission permission={section.permission}><ResourcePage section={section} />{section.id === 'flags' && <FlagSimulator />}</Permission>} />)}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function Permission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth.can(permission)) return <Navigate to="/" replace />;
  return children;
}

void sectionById;
