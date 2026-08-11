import {
  BadgeDollarSign, BookOpenText, Boxes, BriefcaseBusiness, Bug, CircleGauge, ClipboardCheck,
  CreditCard, FileClock, FileText, Flag, GalleryVerticalEnd, Globe2, HardDrive, Headphones,
  Image, Inbox, Languages, LayoutDashboard, Mail, Megaphone, MessageSquareText, MonitorSmartphone, PackageCheck, Paintbrush,
  ReceiptText, ScrollText, Settings2, Shield, ShieldAlert, ShoppingBag, Store, Tags, Ticket,
  Trash2, WandSparkles,
} from 'lucide-react';

export type Section = {
  id: string;
  path: string;
  label: string;
  description: string;
  group: string;
  permission: string;
  endpoint?: string;
  resultKeys?: string[];
  icon: typeof Store;
};

export const sections: Section[] = [
  { id: 'dashboard', path: '/', label: 'Dashboard', description: 'Platform health, growth and urgent work', group: 'Overview', permission: 'dashboard:view', icon: LayoutDashboard },
  { id: 'stores', path: '/stores', label: 'Stores', description: 'Seller lifecycle, devices, subscription and trust state', group: 'Accounts', permission: 'sellers:view', endpoint: '/api/admin/v1/stores', resultKeys: ['stores'], icon: Store },
  { id: 'buyers', path: '/buyers', label: 'Customers', description: 'Store-scoped buyers, privacy and abuse controls', group: 'Accounts', permission: 'buyers:view', endpoint: '/api/admin/v1/buyers', resultKeys: ['items'], icon: ShoppingBag },
  { id: 'privacy', path: '/buyers/privacy', label: 'Customer privacy', description: 'Access, correction, deletion and restriction request lifecycle', group: 'Accounts', permission: 'buyers:view', endpoint: '/api/admin/v1/buyer-privacy', resultKeys: ['items'], icon: Shield },
  { id: 'support', path: '/support', label: 'Support', description: 'Ticket assignment, priority and replies', group: 'Accounts', permission: 'support:view', endpoint: '/api/admin/v1/support/tickets', resultKeys: ['tickets'], icon: Headphones },
  { id: 'deletions', path: '/deletions', label: 'Deletion & Trust', description: 'Identity verification, deadlines and safe retries', group: 'Accounts', permission: 'deletions:view', endpoint: '/api/admin/v1/deletion-requests', resultKeys: ['requests'], icon: Trash2 },

  { id: 'subscriptions', path: '/commerce/subscriptions', label: 'Subscriptions', description: 'Lifecycle, usage, grace and Play reconciliation', group: 'Commerce', permission: 'subscriptions:view', endpoint: '/api/admin/v1/subscriptions', resultKeys: ['subscriptions'], icon: CreditCard },
  { id: 'plans', path: '/commerce/plans', label: 'Plans & limits', description: 'Immutable revisions, entitlements and governed limits', group: 'Commerce', permission: 'plans:view', endpoint: '/api/admin/v1/plan-catalog', resultKeys: ['plans', 'revisions', 'definitions', 'values'], icon: Boxes },
  { id: 'coupons', path: '/commerce/coupons', label: 'Coupons', description: 'Coupon lifecycle and redemption constraints', group: 'Commerce', permission: 'coupons:view', endpoint: '/api/admin/v1/coupons', resultKeys: ['coupons'], icon: Ticket },
  { id: 'affiliate', path: '/commerce/affiliate', label: 'Referrals & payouts', description: 'Affiliate configuration, referrals and payout state', group: 'Commerce', permission: 'affiliate:view', endpoint: '/api/admin/v1/referrals', resultKeys: ['referrals'], icon: BadgeDollarSign },
  { id: 'ads', path: '/commerce/ads', label: 'Advertising', description: 'First-party creatives, targeting and delivery', group: 'Commerce', permission: 'ads:view', endpoint: '/api/admin/v1/ads', resultKeys: ['ads'], icon: GalleryVerticalEnd },
  { id: 'exports', path: '/commerce/exports', label: 'Exports', description: 'Governed, expiring and audited data exports', group: 'Commerce', permission: 'export:view', endpoint: '/api/admin/v1/exports', resultKeys: ['items'], icon: ReceiptText },

  { id: 'flags', path: '/governance/flags', label: 'Feature flags', description: 'Scoped rollout rules and deterministic simulation', group: 'Governance', permission: 'flags:view', endpoint: '/api/admin/v1/flags', resultKeys: ['items', 'rules'], icon: Flag },
  { id: 'versions', path: '/governance/versions', label: 'App versions', description: 'Warnings, minimums, forced update and kill rules', group: 'Governance', permission: 'versions:view', endpoint: '/api/admin/v1/app-versions', resultKeys: ['items'], icon: MonitorSmartphone },
  { id: 'capabilities', path: '/governance/capabilities', label: 'Capabilities', description: 'Truthful enforcement, runtime consumers and active store controls', group: 'Governance', permission: 'capabilities:view', endpoint: '/api/admin/v1/capabilities', resultKeys: ['items', 'store_controls'], icon: PackageCheck },
  { id: 'runtime', path: '/governance/runtime', label: 'Runtime config', description: 'Effective state below deployment hard gates', group: 'Governance', permission: 'settings:view', endpoint: '/api/admin/v1/runtime-config', resultKeys: ['controls'], icon: CircleGauge },

  { id: 'announcements', path: '/communication/announcements', label: 'Announcements', description: 'Targeted seller communication', group: 'Communication', permission: 'announcements:view', endpoint: '/api/admin/v1/announcements', resultKeys: ['announcements'], icon: Megaphone },
  { id: 'translations', path: '/communication/translations', label: 'Translations', description: 'Product translation provenance and review', group: 'Communication', permission: 'translations:view', endpoint: '/api/admin/v1/product-translations', resultKeys: ['translations'], icon: Languages },
  { id: 'emails', path: '/communication/emails', label: 'Email', description: 'Templates and application send attempts', group: 'Communication', permission: 'emails:view', endpoint: '/api/admin/v1/email-templates', resultKeys: ['templates'], icon: Mail },
  { id: 'email-events', path: '/communication/email-events', label: 'Email events', description: 'Application send attempts and provider event evidence', group: 'Communication', permission: 'emails:view', endpoint: '/api/admin/v1/email-events', resultKeys: ['events'], icon: FileClock },
  { id: 'inbox', path: '/communication/inbox', label: 'Inbound inbox', description: 'Inbound support and operational mail', group: 'Communication', permission: 'emails:view', endpoint: '/api/admin/v1/inbound-emails', resultKeys: ['emails', 'messages'], icon: Inbox },
  { id: 'macros', path: '/communication/support-macros', label: 'Support macros', description: 'Audited, localized reply templates for support workflows', group: 'Communication', permission: 'support:view', endpoint: '/api/admin/v1/support-macros', resultKeys: ['items'], icon: MessageSquareText },
  { id: 'content', path: '/communication/content', label: 'Content & legal', description: 'Versioned legal, onboarding, pricing and support content', group: 'Communication', permission: 'content:view', endpoint: '/api/admin/v1/content-configs', resultKeys: ['items'], icon: FileText },

  { id: 'jobs', path: '/system/jobs', label: 'Jobs', description: 'Health, execution history and owner retries', group: 'System', permission: 'operations:view', endpoint: '/api/admin/v1/operations/jobs', resultKeys: ['runs'], icon: FileClock },
  { id: 'audit', path: '/system/audit', label: 'Audit log', description: 'Platform-wide immutable mutation history', group: 'System', permission: 'audit:view', endpoint: '/api/admin/v1/audit', resultKeys: ['audit'], icon: ScrollText },
  { id: 'errors', path: '/system/errors', label: 'Errors', description: 'Sanitized application failures and diagnosis', group: 'System', permission: 'errors:view', endpoint: '/api/admin/v1/errors', resultKeys: ['errors'], icon: Bug },
  { id: 'security', path: '/system/security', label: 'Security', description: 'Sessions, MFA, alerts, invitations and critical actions', group: 'System', permission: 'security:view', endpoint: '/api/admin/v1/security', resultKeys: ['alerts'], icon: ShieldAlert },
  { id: 'admins', path: '/system/access', label: 'Admin access', description: 'Fixed roles, invitations and access lifecycle', group: 'System', permission: 'admins:view', endpoint: '/api/admin/v1/access/admins', resultKeys: ['items'], icon: Shield },
  { id: 'settings', path: '/system/settings', label: 'Settings & theme', description: 'System settings and design tokens', group: 'System', permission: 'settings:view', endpoint: '/api/admin/v1/settings', resultKeys: ['settings'], icon: Settings2 },
  { id: 'theme', path: '/system/theme', label: 'Design system', description: 'Generated colors, typography, spacing and shapes for every product surface', group: 'System', permission: 'theme:view', endpoint: '/api/admin/v1/theme', resultKeys: ['active'], icon: Paintbrush },

  { id: 'roadmap', path: '/internal/roadmap', label: 'Roadmap', description: 'Internal roadmap and execution status', group: 'Engineering', permission: 'roadmap:view', endpoint: '/api/admin/v1/roadmap', resultKeys: ['items', 'roadmap'], icon: ClipboardCheck },
  { id: 'tasks', path: '/internal/tasks', label: 'Tasks', description: 'Internal delivery tasks', group: 'Engineering', permission: 'tasks:view', endpoint: '/api/admin/v1/tasks', resultKeys: ['items', 'tasks'], icon: BriefcaseBusiness },
  { id: 'releases', path: '/internal/releases', label: 'Releases', description: 'Release readiness and history', group: 'Engineering', permission: 'releases:view', endpoint: '/api/admin/v1/releases', resultKeys: ['items', 'releases'], icon: PackageCheck },
  { id: 'bugs', path: '/internal/bugs', label: 'Bugs', description: 'Internal defects, severity and resolution ownership', group: 'Engineering', permission: 'bugs:view', endpoint: '/api/admin/v1/bugs', resultKeys: ['bugs'], icon: Bug },
  { id: 'manifests', path: '/internal/manifests', label: 'Coverage manifests', description: 'Android screens and backend endpoint coverage', group: 'Engineering', permission: 'screens:view', endpoint: '/api/admin/v1/screens', resultKeys: ['items', 'screens'], icon: HardDrive },
  { id: 'prompts', path: '/internal/prompts', label: 'AI prompts', description: 'Prompt assets and effective runtime selection', group: 'Engineering', permission: 'prompts:view', endpoint: '/api/admin/v1/prompts', resultKeys: ['items', 'prompts'], icon: WandSparkles },
  { id: 'docs', path: '/internal/docs', label: 'Docs & design', description: 'Documentation and design asset links', group: 'Engineering', permission: 'docs:view', endpoint: '/api/admin/v1/project-docs', resultKeys: ['items', 'docs'], icon: BookOpenText },
  { id: 'design', path: '/internal/design', label: 'Design assets', description: 'Figma, Canva and exported design references', group: 'Engineering', permission: 'design:view', endpoint: '/api/admin/v1/design-assets', resultKeys: ['assets'], icon: Image },
  { id: 'locales', path: '/internal/locales', label: 'Storefront locales', description: 'Supported locale definitions without architecture changes', group: 'Engineering', permission: 'plans:view', endpoint: '/api/admin/v1/storefront-locales', resultKeys: ['locales'], icon: Globe2 },
  { id: 'tags', path: '/internal/endpoints', label: 'API endpoints', description: 'Backend endpoint manifest and ownership', group: 'Engineering', permission: 'endpoints:view', endpoint: '/api/admin/v1/endpoints', resultKeys: ['items', 'endpoints'], icon: Tags },
];

export const sectionById = Object.fromEntries(sections.map(section => [section.id, section]));
