// ============================================================
// Public router — resolves customer-facing URLs to store resources.
//
//   /{public_identifier}                     -> store page  (GET) / order (POST)
//   /{public_identifier}/c/{category_code}   -> category page
//   /{public_identifier}/p/{product_code}    -> product page
//   /{public_identifier}/{module}/{code}     -> future modules (registry)
//
//   /c/{legacy_identifier}                   -> 301 to /{public_identifier}
//
// Future ERP modules (offers, branches, tables, events, coupons, services) are
// added by registering one handler in RESOURCE_REGISTRY — the routing shape
// never changes. Every resource is resolved by its code AND store ownership,
// so a category/product can only be reached through the store that owns it.
// ============================================================

import { findStoreByIdentifier, storeUrl } from "../domains/identity/identity";
import { designSystemCss, loadActiveDesignSystem } from "../domains/design/design-system";
import {
	renderStorePage,
	renderCategoryPage,
	renderProductPage,
	handleCatalogOrder,
} from "../domains/catalog/catalog";
import { pickLocale, DEFAULT_LOCALE, type Locale } from "../platform/localization/i18n";
import { checkRateLimit, esc } from "../platform/http/shared";
import { storeCapabilityEnabled } from "../domains/operations/capabilities";
import { Hono } from "hono";

type Store = Record<string, unknown>;
type ResourceHandler = (env: PublicWorkerEnv, store: Store, code: string, request: Request) => Promise<Response>;

function notFound(): Response {
	return new Response("غير موجود", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

function redirect301(location: string): Response {
	return new Response(null, { status: 301, headers: { location } });
}

function deletionPage(lang: Locale, submitted = false, generatedCss = ""): Response {
	const ar = lang === "ar";
	const title = ar ? "طلب حذف حساب أوردرك" : "Delete your Orderak account";
	const intro = ar
		? "يمكنك طلب حذف حسابك والبيانات المرتبطة به. سنتحقق من ملكية رقم الهاتف قبل تنفيذ الحذف خلال مدة لا تتجاوز 90 يومًا."
		: "Request deletion of your account and associated data. We verify ownership of the phone number before completing deletion within 90 days.";
	const result = submitted
		? `<p class="ok">${ar ? "تم استلام طلبك. سيتواصل معك فريق الدعم للتحقق من الهوية." : "Your request was received. Support will contact you to verify your identity."}</p>`
		: "";
	const html = `<!doctype html><html lang="${lang}" dir="${ar ? "rtl" : "ltr"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${generatedCss}body{font-family:var(--orderak-font-family,system-ui,sans-serif);max-width:680px;margin:40px auto;padding:0 20px;line-height:1.7;color:var(--md-sys-color-on-surface,#17201b);background:var(--md-sys-color-background,#fff)}h1{color:var(--md-sys-color-primary,#087443)}label{display:block;margin-top:14px;font-weight:600}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid var(--md-sys-color-outline,#8b9690);border-radius:var(--orderak-shape-small,8px);background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#17201b)}button{min-height:var(--orderak-minimum-touch-target,48px);margin-top:18px;padding:12px 20px;border:0;border-radius:var(--orderak-shape-small,8px);background:var(--md-sys-color-primary,#087443);color:var(--md-sys-color-on-primary,white);font-weight:700}.ok{padding:12px;background:var(--md-sys-color-success-container,#e7f6ed);border-radius:8px}.muted{color:var(--md-sys-color-on-surface-variant,#53615a);font-size:.92rem}</style></head>
<body><h1>${title}</h1><p>${intro}</p>${result}
<form method="post" action="/delete-account">
<label for="phone">${ar ? "رقم الهاتف بصيغة دولية" : "Phone number in international format"}</label>
<input id="phone" name="phone" type="tel" placeholder="+201001234567" required pattern="\\+20[0-9]{10}" autocomplete="tel">
<label for="email">${ar ? "البريد الإلكتروني (اختياري)" : "Email address (optional)"}</label>
<input id="email" name="email" type="email" autocomplete="email">
<input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
<button type="submit">${ar ? "إرسال طلب الحذف" : "Submit deletion request"}</button></form>
<p class="muted">${ar ? "سيتم حذف الحساب والصفحة العامة والكتالوج والبيانات الشخصية، باستثناء السجلات التي يفرض القانون الاحتفاظ بها. إلغاء الاشتراك المدفوع - إن وجد - يتم قبل إغلاق الحساب." : "Deletion covers the account, public store, catalog, and personal data, except records that law requires us to retain. Any paid subscription must be cancelled before account closure."}</p>
<p><a href="mailto:support@orderak.app">support@orderak.app</a> · <a href="/privacy">${ar ? "سياسة الخصوصية" : "Privacy Policy"}</a></p></body></html>`;
	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" } });
}

async function handleDeletionRequest(request: Request, env: PublicWorkerEnv, lang: Locale): Promise<Response> {
	if (request.method === "GET") {
		const revision = await loadActiveDesignSystem(env, request);
		return deletionPage(lang, false, designSystemCss(revision.snapshot));
	}
	if (request.method !== "POST") return notFound();
	const ip = request.headers.get("cf-connecting-ip") || "unknown";
	if (!(await checkRateLimit(env, `delete-request:ip:${ip}`, 5, 3600))) {
		return new Response("Too many requests", { status: 429 });
	}
	const form = await request.formData().catch(() => null);
	if (!form || String(form.get("company") ?? "")) return deletionPage(lang, true);
	const phone = String(form.get("phone") ?? "").replace(/[\s()-]/g, "");
	const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
	if (!/^\+20\d{10}$/.test(phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
		return new Response("Invalid request", { status: 400 });
	}
	const existing = await env.orderak_db.prepare(
		"SELECT id FROM deletion_requests WHERE phone_e164=? AND status IN ('pending','verified') LIMIT 1",
	).bind(phone).first();
	if (!existing) {
		await env.orderak_db.prepare(
			`INSERT INTO deletion_requests(id,phone_e164,email,locale,source,deadline_at)
			 VALUES(?,?,?,?,?,datetime('now','+90 days'))`,
		).bind(crypto.randomUUID(), phone, email || null, lang, "public_web",).run();
	}
	const revision = await loadActiveDesignSystem(env, request);
	return deletionPage(lang, true, designSystemCss(revision.snapshot));
}

// ---- Resource handlers (ownership-scoped) ----------------------------------

async function handleCategory(env: PublicWorkerEnv, store: Store, code: string, request: Request): Promise<Response> {
	const category = (await env.orderak_db
		.prepare(
			`SELECT id, category_code, name, slug FROM categories
			 WHERE store_id = ? AND category_code = ? COLLATE NOCASE`,
		)
		.bind(store.id, code)
		.first()) as Record<string, unknown> | null;
	if (!category) return notFound();
	return renderCategoryPage(env, store, category, pickLocale(request, new URL(request.url)));
}

async function handleProduct(env: PublicWorkerEnv, store: Store, code: string, request: Request): Promise<Response> {
	const product = (await env.orderak_db
		.prepare(
			`SELECT id, product_code, name, slug, description, price_minor, stock, available, image_url
			 FROM products WHERE store_id = ? AND product_code = ? COLLATE NOCASE`,
		)
		.bind(store.id, code)
		.first()) as Record<string, unknown> | null;
	if (!product) return notFound();
	return renderProductPage(env, store, product, pickLocale(request, new URL(request.url)));
}

// Extensible registry — add a new ERP module by registering one handler here.
const RESOURCE_REGISTRY: Record<string, ResourceHandler> = {
	c: handleCategory,
	p: handleProduct,
	// Future: offers, branches, tables, events, coupons, services.
};

// ---- Entry point -----------------------------------------------------------

/**
 * Render a content page (terms, privacy, help) from the content_pages table.
 * Falls back to the other language if the requested one has no active row.
 */
async function renderContentPage(env: PublicWorkerEnv, slug: string, lang: Locale): Promise<Response> {
	// Try the requested language first.
	let row = (await env.orderak_db
		.prepare("SELECT title, body_html FROM content_page_versions WHERE slug=? AND lang=? AND status='published' ORDER BY version DESC LIMIT 1")
		.bind(slug, lang)
		.first()) as { title: string; body_html: string } | null;

	// Fallback to the other language.
	if (!row) {
		const other: Locale = lang === "ar" ? "en" : "ar";
		row = (await env.orderak_db
			.prepare("SELECT title, body_html FROM content_page_versions WHERE slug=? AND lang=? AND status='published' ORDER BY version DESC LIMIT 1")
			.bind(slug, other)
			.first()) as { title: string; body_html: string } | null;
	}

	if (!row) {
		return new Response("غير موجود", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}

	const revision = await loadActiveDesignSystem(env);
	const t = revision.legacyTheme;
	const dir = lang === "ar" ? "rtl" : "ltr";
	const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(row.title)}</title>
<style>${designSystemCss(revision.snapshot)}
  body{font-family:system-ui,'Segoe UI',Tahoma,Arial;max-width:720px;margin:40px auto;padding:0 20px;color:${t.ink};line-height:1.7}
  h1{color:${t.primary};font-size:24px}
</style>
</head>
<body><h1>${esc(row.title)}</h1>${row.body_html}</body>
</html>`;

	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Handle a public store URL. Returns a Response, or null if the path is not a
 * public store route (so the caller can 404). Assumes /api, admin, /media, /
 * and /health were already handled upstream.
 */
const app = new Hono<{ Bindings: PublicWorkerEnv }>();

// Literal paths first — they must not be swallowed by the /:pid store route.
app.all("/delete-account", (c) =>
	handleDeletionRequest(c.req.raw, c.env, pickLocale(c.req.raw, new URL(c.req.url))));

app.get("/terms", (c) => renderContentPage(c.env, "terms", pickLocale(c.req.raw, new URL(c.req.url))));
app.get("/privacy", (c) => renderContentPage(c.env, "privacy", pickLocale(c.req.raw, new URL(c.req.url))));
app.all("/terms", () => notFound());
app.all("/privacy", () => notFound());

// Legacy store URL: /c/{identifier} -> 301 to /{public_identifier}. In the
// current scheme "c" only appears as a *second* segment, so a leading "/c/" is
// unambiguously the old form.
const legacyStoreRedirect = async (c: { env: PublicWorkerEnv; req: { param: (k: string) => string } }) => {
	const store = await findStoreByIdentifier(c.env, decodeURIComponent(c.req.param("identifier")));
	if (!store) return notFound();
	return redirect301(storeUrl(String(store.public_identifier)));
};
app.all("/c/:identifier", legacyStoreRedirect);
// The original matched on segments[0] === "c" and ignored anything past
// segments[1], so deeper legacy URLs redirect too rather than falling through
// to the /:pid/:module/:code route.
app.all("/c/:identifier/*", legacyStoreRedirect);
app.all("/c", () => notFound());

/**
 * Resolve the store named by the first path segment, applying the same
 * ownership and visibility rules for every public route below.
 */
async function resolveVisibleStore(env: PublicWorkerEnv, identifier: string): Promise<Store | null> {
	const store = await findStoreByIdentifier(env, identifier);
	if (!store) return null;
	if (String(store.status ?? "active") !== "active") return null;
	if (!(await storeCapabilityEnabled(env, String(store.id), "catalog.public", true))) return null;
	return store;
}

// ---- Store root: /{pid} ----
app.all("/:pid", async (c) => {
	const first = decodeURIComponent(c.req.param("pid"));
	const store = await resolveVisibleStore(c.env, first);
	if (!store) return notFound();

	if (c.req.method === "POST") return handleCatalogOrder(c.req.raw, c.env, store);
	if (c.req.method !== "GET") return notFound();

	// Canonicalize aliases (bare slug / store_code) to the full identifier.
	const canonical = String(store.public_identifier);
	if (first !== canonical) return redirect301(storeUrl(canonical));
	return renderStorePage(c.env, store, pickLocale(c.req.raw, new URL(c.req.url)));
});

// ---- Sub-resource: /{pid}/{module}/{code} ----
app.all("/:pid/:module/:code", async (c) => {
	if (c.req.method !== "GET") return notFound();
	const store = await resolveVisibleStore(c.env, decodeURIComponent(c.req.param("pid")));
	if (!store) return notFound();

	const handler = RESOURCE_REGISTRY[c.req.param("module").toLowerCase()];
	const code = decodeURIComponent(c.req.param("code"));
	if (!handler || !code) return notFound();
	return handler(c.env, store, code, c.req.raw);
});

app.all("*", () => notFound());

/**
 * Handle a public store URL. Returns a Response, or null if the path is empty
 * (so the caller can serve "/"). Assumes /api, admin, /media and /health were
 * already handled upstream.
 */
export async function handlePublicRoutes(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response | null> {
	if (url.pathname.split("/").filter(Boolean).length === 0) return null;
	return app.fetch(request, env);
}
