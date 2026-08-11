export type AdminRole = "owner" | "finance" | "support" | "readonly";

export type CapabilityStatus = "enforced" | "display_only" | "planned";
export type AdminRisk = "low" | "medium" | "high" | "critical";

export interface AdminIdentity {
	id: number;
	email: string;
	name: string | null;
	role: AdminRole;
	lang: string;
	timezone: string;
	mfaEnabled: boolean;
	mustChangePassword: boolean;
	/**
	 * Whether this admin has acknowledged their recovery codes.
	 *
	 * The server already gates every admin route with a 428 until they do, but
	 * without this on the identity the client cannot tell an interrupted
	 * enrollment from a completed one, so it cannot resume the flow - it can only
	 * bounce off the 428. Ported from main, where it was added to recover
	 * interrupted MFA enrollment.
	 */
	recoveryCodesAcknowledged: boolean;
}

export interface AdminSessionResponse {
	ok: true;
	admin: AdminIdentity;
	permissions: string[];
	csrf_token: string;
	server_time: string;
}

export interface ApiErrorBody {
	type: string;
	title: string;
	status: number;
	code: string;
	detail: string;
	request_id: string;
	field_errors?: Record<string, string>;
}

export interface CapabilityDefinition {
	key: string;
	domain: string;
	label: string;
	description: string;
	status: CapabilityStatus;
	enforcement_binding: string | null;
	runtime_consumer: string | null;
	risk: AdminRisk;
	scopes: string[];
}

export interface AdminSection {
	key: string;
	label: string;
	path: string;
	permission: string;
	domain: string;
}

export const ADMIN_SECTIONS: AdminSection[] = [
	{ key: "dashboard", label: "Dashboard", path: "/", permission: "dashboard:view", domain: "Overview" },
	{ key: "stores", label: "Stores", path: "/stores", permission: "sellers:view", domain: "Accounts" },
	{ key: "buyers", label: "Customers", path: "/buyers", permission: "buyers:view", domain: "Accounts" },
	{ key: "privacy", label: "Customer privacy", path: "/buyers/privacy", permission: "buyers:view", domain: "Accounts" },
	{ key: "support", label: "Support", path: "/support", permission: "support:view", domain: "Accounts" },
	{ key: "deletions", label: "Deletion & trust", path: "/deletions", permission: "deletions:view", domain: "Accounts" },
	{ key: "subscriptions", label: "Subscriptions", path: "/commerce/subscriptions", permission: "subscriptions:view", domain: "Commerce" },
	{ key: "plans", label: "Plans & limits", path: "/commerce/plans", permission: "plans:view", domain: "Commerce" },
	{ key: "coupons", label: "Coupons", path: "/commerce/coupons", permission: "coupons:view", domain: "Commerce" },
	{ key: "affiliate", label: "Referrals & payouts", path: "/commerce/affiliate", permission: "affiliate:view", domain: "Commerce" },
	{ key: "ads", label: "Advertising", path: "/commerce/ads", permission: "ads:view", domain: "Commerce" },
	{ key: "exports", label: "Exports", path: "/commerce/exports", permission: "export:view", domain: "Commerce" },
	{ key: "flags", label: "Feature flags", path: "/governance/flags", permission: "flags:view", domain: "Governance" },
	{ key: "versions", label: "App versions", path: "/governance/versions", permission: "versions:view", domain: "Governance" },
	{ key: "capabilities", label: "Capabilities", path: "/governance/capabilities", permission: "capabilities:view", domain: "Governance" },
	{ key: "runtime", label: "Runtime configuration", path: "/governance/runtime", permission: "settings:view", domain: "Governance" },
	{ key: "announcements", label: "Announcements", path: "/communication/announcements", permission: "announcements:view", domain: "Communication" },
	{ key: "translations", label: "Translations", path: "/communication/translations", permission: "translations:view", domain: "Communication" },
	{ key: "emails", label: "Email", path: "/communication/emails", permission: "emails:view", domain: "Communication" },
	{ key: "email-events", label: "Email events", path: "/communication/email-events", permission: "emails:view", domain: "Communication" },
	{ key: "inbox", label: "Inbox", path: "/communication/inbox", permission: "emails:view", domain: "Communication" },
	{ key: "macros", label: "Support macros", path: "/communication/support-macros", permission: "support:view", domain: "Communication" },
	{ key: "content", label: "Content & legal", path: "/communication/content", permission: "content:view", domain: "Communication" },
	{ key: "jobs", label: "Operational jobs", path: "/system/jobs", permission: "operations:view", domain: "System" },
	{ key: "audit", label: "Audit log", path: "/system/audit", permission: "audit:view", domain: "System" },
	{ key: "errors", label: "Error log", path: "/system/errors", permission: "errors:view", domain: "System" },
	{ key: "security", label: "Admin security", path: "/system/security", permission: "security:view", domain: "System" },
	{ key: "admins", label: "Administrators", path: "/system/access", permission: "admins:view", domain: "System" },
	{ key: "settings", label: "Settings", path: "/system/settings", permission: "settings:view", domain: "System" },
	{ key: "theme", label: "Design system", path: "/system/theme", permission: "theme:view", domain: "System" },
	{ key: "roadmap", label: "Roadmap", path: "/internal/roadmap", permission: "roadmap:view", domain: "Internal" },
	{ key: "tasks", label: "Tasks", path: "/internal/tasks", permission: "tasks:view", domain: "Internal" },
	{ key: "releases", label: "Releases", path: "/internal/releases", permission: "releases:view", domain: "Internal" },
	{ key: "bugs", label: "Bugs", path: "/internal/bugs", permission: "bugs:view", domain: "Internal" },
	{ key: "manifests", label: "Coverage manifests", path: "/internal/manifests", permission: "screens:view", domain: "Internal" },
	{ key: "prompts", label: "AI prompts", path: "/internal/prompts", permission: "prompts:view", domain: "Internal" },
	{ key: "docs", label: "Documentation", path: "/internal/docs", permission: "docs:view", domain: "Internal" },
	{ key: "design", label: "Design assets", path: "/internal/design", permission: "design:view", domain: "Internal" },
	{ key: "locales", label: "Storefront locales", path: "/internal/locales", permission: "plans:view", domain: "Internal" },
	{ key: "tags", label: "API endpoints", path: "/internal/endpoints", permission: "endpoints:view", domain: "Internal" },
];

export const ACTIVE_ADMIN_DOMAINS = [
	"subscriptions", "buyers", "sellers", "plans", "entitlements", "limits", "feature_flags",
	"runtime_config", "app_versions", "content", "store_controls", "support", "payouts", "ads",
	"translations", "jobs", "audit_security", "internal",
] as const;
