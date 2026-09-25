import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, type ComponentType } from 'react';
import { AppShell } from '@/app/layout/AppShell';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { useAuth } from '@/features/auth/auth-context';
import { AccountSecurityGate } from '@/features/auth/AccountSecurityGate';
import DashboardPage from '@/features/dashboard/DashboardPage';
import { RefineResourcePage } from '@/features/resources/RefineResourcePage';
import { sections, sectionById, type Section } from '@/app/config/sections';

// Eager above, lazy below.
//
// Eager is the shell an administrator always needs: the login screen, the
// security gate, the chrome, the dashboard they land on, and
// RefineResourcePage, which backs every Refine-migrated generic section at
// once (most of them, after the Refine install plan's Phase 3) and so is
// reachable from most of the navigation. The old `ResourcePage` now backs
// only `flags`/`capabilities` and moved to the lazy group below with
// everything else that's a once-per-session destination.
//
// Everything below is a destination someone navigates to, and typically one of
// them per session — so it does not belong in the chunk that has to parse before
// the login form can paint. ThemeBuilderPage was already split this way; this
// applies the same treatment to the rest.
//
// These modules export named components rather than defaults, so each import is
// mapped to the { default } shape lazy() requires.
const ResourcePage = lazyNamed<'ResourcePage', { section: Section }>(() => import('@/features/resources/ResourcePage'), 'ResourcePage');
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
const AuditPage = lazyNamed(() => import('@/features/system/AuditPage'), 'AuditPage');
const TasksPage = lazyNamed(() => import('@/features/engineering/TasksPage'), 'TasksPage');

/** lazy() for a module that exports the component under a name, not as default. */
function lazyNamed<K extends string, P extends object = Record<string, never>>(
  load: () => Promise<Record<K, ComponentType<P>>>,
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
    {/* Phase 4 of the Refine install plan: the list halves of these two
        (StoresPage/SupportPage) gate themselves with <CanAccess>, like
        every Refine-migrated list; the detail routes are untouched, plain
        React, and keep the route-level <Permission> wrapper. */}
    <Route path="stores" element={<StoresPage />} />
    <Route path="stores/:id" element={<Permission permission="sellers:view"><StoreDetailPage /></Permission>} />
    <Route path="support" element={<SupportPage />} />
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
    {/* Refine install plan: resources migrated off the generic ResourcePage
        gate themselves with Refine's <CanAccess> instead of the
        <Permission> wrapper every route below still uses — deliberate,
        and scoped to only the resources actually migrated so far. */}
    <Route path="system/audit" element={<AuditPage />} />
    <Route path="internal/tasks" element={<TasksPage />} />
    {/* flags/capabilities stay on the pre-Refine path: their real API
        response returns more than one row group at once (see
        ResourcePage.tsx), which doesn't fit Refine's one-resource-one-array
        getList. */}
    {sections.filter(section => ['flags', 'capabilities'].includes(section.id)).map(section => <Route key={section.id} path={section.path.slice(1)} element={<Permission permission={section.permission}><ResourcePage section={section} />{section.id === 'flags' && <FlagSimulator />}</Permission>} />)}
    {sections.filter(section => !['dashboard', 'stores', 'support', 'deletions', 'runtime', 'jobs', 'security', 'admins', 'plans', 'theme', 'billing-verifications', 'audit', 'tasks', 'flags', 'capabilities'].includes(section.id)).map(section => <Route key={section.id} path={section.path.slice(1)} element={<RefineResourcePage section={section} />} />)}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function Permission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const auth = useAuth();
  if (!auth.can(permission)) return <Navigate to="/" replace />;
  return children;
}

void sectionById;
