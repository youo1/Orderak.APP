// ============================================================
// Catalog rendering — the public, customer-facing store pages.
//
//   renderStorePage      GET /{public_identifier}
//   renderCategoryPage   GET /{public_identifier}/c/{category_code}
//   renderProductPage    GET /{public_identifier}/p/{product_code}
//   handleCatalogOrder   POST /{public_identifier}   (order submission)
//
// SEO-friendly: every page emits a canonical URL, description, Open Graph +
// Twitter cards, and (product pages) JSON-LD. The rendered HTML never contains
// a phone number as a URL segment nor any internal UUID — products are
// referenced by their immutable public `product_code`.
// ============================================================

import { esc, jsonResponse, logError, checkRateLimit } from "../../platform/http/shared";
import { PUBLIC_SITE_URL, storeUrl, newUuid } from "../identity/identity";
import { requireTenantWrite, resolveTenantContextForStore, TenantWriteFencedError } from "../../platform/tenancy/tenant-routing";
import { getPlanLimit, limitReached } from "../commerce/plan-limits";
import type { Theme } from "../design/theme";
import { designSystemCss, designSystemFontPreload, loadActiveDesignSystem } from "../design/design-system";
import { dirFor, t, type Locale } from "../../platform/localization/i18n";
import { entitlementLimitReached, reserveUsage, voidUsageReservation } from "../commerce/entitlements";
import { storeCapabilityEnabled } from "../operations/capabilities";
import { keyedHash } from "../identity/auth";
import { type Currency, exponentOf } from "../../platform/money/money";

type Store = Record<string, unknown>;

/**
 * Render an amount for the storefront.
 *
 * The caller appends the currency word from the translation table, so this
 * formats the number only — but the number of decimal places still comes from
 * the currency rather than a constant. `egpLabel` divided by a literal 100,
 * which renders 15000 fils as "150" instead of "15.000" (ADR-009).
 */
function amountLabel(amountMinor: number, currency: Currency, lang: Locale): string {
	const exponent = exponentOf(currency);
	return (amountMinor / 10 ** exponent).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG", {
		minimumFractionDigits: exponent,
		maximumFractionDigits: exponent,
	});
}

// ---- SEO <head> ------------------------------------------------------------

interface SeoOptions {
	title: string;
	description: string;
	canonical: string;
	image?: string | null;
	type?: "website" | "product";
}

function seoHead(o: SeoOptions, t: Theme): string {
	const desc = esc(o.description.slice(0, 300));
	const title = esc(o.title);
	const canonical = esc(o.canonical);
	const img = o.image ? esc(o.image) : "";
	return `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="${t.primary}">
<link rel="canonical" href="${canonical}">
<meta property="og:site_name" content="Orderak">
<meta property="og:type" content="${o.type ?? "website"}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
${img ? `<meta property="og:image" content="${img}">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
${img ? `<meta name="twitter:image" content="${img}">` : ""}`.trim();
}

const baseStyle = (t: Theme) => `
:root{--g:${t.primary};--bg:${t.canvas};--tx:${t.ink};--mut:${t.muted}}
*{box-sizing:border-box;margin:0;font-family:var(--orderak-font-family,system-ui,'Segoe UI',Tahoma)}
body{background:var(--bg);color:var(--tx);padding:16px;max-width:520px;margin:auto}
a{color:var(--g)}
.cover{width:100%;height:150px;object-fit:cover;border-radius:16px;background:#eee}
.head{display:flex;align-items:center;gap:12px;margin:12px 0}
.logo,.nologo{width:64px;height:64px;border-radius:16px;object-fit:cover;background:#eee;display:flex;align-items:center;justify-content:center;font-size:30px;flex:0 0 auto}
.head h1{font-size:22px}
.desc{color:var(--mut);font-size:14px;margin:6px 0 12px}
.contact{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.contact a{background:#fff;border:1px solid #eee;border-radius:999px;padding:6px 12px;font-size:13px;text-decoration:none}
.crumb{font-size:13px;color:var(--mut);margin:4px 0 12px}
.sec{font-size:16px;font-weight:700;margin:16px 0 8px}
.chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px}
.chip{white-space:nowrap;background:#fff;border:1px solid #eee;border-radius:999px;padding:6px 12px;font-size:13px;text-decoration:none;color:var(--tx)}
.card{display:flex;align-items:center;gap:10px;background:#fff;border-radius:14px;padding:10px;margin-bottom:10px;box-shadow:0 1px 4px #0001}
.card img,.noimg{width:64px;height:64px;border-radius:10px;object-fit:cover;background:#eee;display:flex;align-items:center;justify-content:center;font-size:28px}
.info{flex:1}.info a{text-decoration:none;color:var(--tx)}.name{font-weight:600}.price{color:var(--g);font-weight:700}
.qty{display:flex;align-items:center;gap:8px;direction:ltr}
.qty button{width:48px;height:48px;border:none;border-radius:8px;background:var(--g);color:#fff;font-size:18px}
form{background:#fff;border-radius:14px;padding:14px;margin-top:16px;box-shadow:0 1px 4px #0001}
label{font-size:13px;color:var(--mut)}
input,select,textarea{width:100%;padding:12px;margin:4px 0 12px;border:1px solid #ddd;border-radius:10px;font-size:16px}
.form-error{color:${t.danger};font-weight:600;margin:8px 0;min-height:1.5em}
.total{font-size:18px;font-weight:700;margin:8px 0}
.btn{width:100%;padding:14px;border:none;border-radius:12px;background:var(--g);color:#fff;font-size:17px;font-weight:700;cursor:pointer}
.ok{background:#E8F7EF;border-radius:14px;padding:16px;text-align:center;display:none;margin-top:16px}
.foot{text-align:center;color:#999;font-size:12px;margin:20px 0}
.foot a{color:var(--g);text-decoration:none;font-weight:600}`;

function pageShell(head: string, body: string, theme: Theme, generatedCss: string, lang: Locale, cacheSeconds = 0): Response {
	const html = `<!doctype html>
<html lang="${lang}" dir="${dirFor(lang)}"><head>
${head}
<style>${generatedCss}${baseStyle(theme)}</style>
</head><body>
${body}
<div class="foot">${esc(t(lang, "catalog.powered_by"))} <a href="${PUBLIC_SITE_URL}">أوردرك Orderak</a></div>
</body></html>`;
	const headers: Record<string, string> = {
		"content-type": "text/html; charset=utf-8",
		"content-language": lang,
		vary: "Accept-Language",
	};
	// Anonymous listing pages can be edge-cached briefly — a viral store link
	// then serves from Cloudflare's cache instead of hitting D1 per view. Kept
	// short (stock is re-validated server-side at order submit, so a stale
	// "in stock" only yields a clear error, never an oversell).
	if (cacheSeconds > 0) {
		headers["cache-control"] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
	}
	return new Response(html, { headers });
}

// ---- Shared partials -------------------------------------------------------

/**
 * Only http(s) URLs may reach href/src attributes. esc() stops attribute
 * breakout but NOT scheme abuse — a stored "javascript:..." website would
 * execute on this public page (stored XSS). Returns null for anything else.
 */
function safeHttpUrl(v: unknown): string | null {
	const s = String(v ?? "").trim();
	return /^https?:\/\//i.test(s) ? s : null;
}

function storeHeader(store: Store, lang: Locale): string {
	const name = esc(store.store_name);
	const coverUrl = safeHttpUrl(store.cover_url);
	const logoUrl = safeHttpUrl(store.logo_url);
	const cover = coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="${esc(name)}">` : "";
	const logo = logoUrl
		? `<img class="logo" src="${esc(logoUrl)}" alt="${esc(name)}">`
		: `<div class="nologo">🛍️</div>`;
	const desc = store.description ? `<div class="desc">${esc(store.description)}</div>` : "";
	const chips: string[] = [];
	if (store.whatsapp) chips.push(`<a href="https://wa.me/${esc(String(store.whatsapp).replace(/\D/g, ""))}">💬 ${esc(t(lang, "catalog.whatsapp"))}</a>`);
	if (store.email) chips.push(`<a href="mailto:${esc(store.email)}">✉️ ${esc(t(lang, "catalog.email"))}</a>`);
	const website = safeHttpUrl(store.website);
	if (website) chips.push(`<a href="${esc(website)}" rel="nofollow">🌐 ${esc(t(lang, "catalog.website"))}</a>`);
	if (store.address) chips.push(`<span class="chip">📍 ${esc(store.address)}</span>`);
	const contact = chips.length ? `<div class="contact">${chips.join("")}</div>` : "";
	return `${cover}<div class="head">${logo}<h1>${name}</h1></div>${desc}${contact}`;
}

function productCard(store: Store, p: Record<string, unknown>, linkToPage: boolean, lang: Locale): string {
	const pid = String(store.public_identifier);
	const code = esc(p.product_code);
	const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}">` : `<div class="noimg" aria-hidden="true">🛍️</div>`;
	const nameHtml = linkToPage
		? `<a href="/${pid}/p/${code}"><div class="name">${esc(p.name)}</div></a>`
		: `<div class="name">${esc(p.name)}</div>`;
	return `
	<div class="card" data-code="${code}" data-price="${p.price_minor}">
		${img}
		<div class="info">${nameHtml}<div class="price">${amountLabel(Number(p.price_minor), String(p.currency ?? "EGP") as Currency, lang)} ${esc(t(lang, "catalog.currency"))}</div></div>
		<div class="qty">
			<button type="button" aria-label="${esc(t(lang, "catalog.decrease"))}" onclick="chg('${code}',-1)">−</button>
			<span id="q_${code}">0</span>
			<button type="button" aria-label="${esc(t(lang, "catalog.increase"))}" onclick="chg('${code}',1,${p.stock})">+</button>
		</div>
	</div>`;
}

// Order form + client script. Posts item {product_code, qty} lists to the
// store's public_identifier root — codes only, never UUIDs.
function orderForm(store: Store, lang: Locale): string {
	const postUrl = "/" + esc(store.public_identifier);
	const js = (key: string) => JSON.stringify(t(lang, key));
	const numberLocale = lang === "ar" ? "ar-EG" : "en-EG";
	// The browser script below works in minor units and needs the divisor for
	// this store's currency. Injected rather than written as 100: KWD, BHD and
	// OMR use 1000, and a literal here is a factor-of-ten error in those markets.
	const storeCurrency = String(store.currency ?? "EGP") as Currency;
	const minorPerMajor = 10 ** exponentOf(storeCurrency);
	const minorDigits = exponentOf(storeCurrency);
	const paymentOptions = [
		String(store.vfcash ?? "").trim() ? `<option value="VF_CASH">${esc(t(lang, "catalog.vfcash"))}</option>` : "",
		String(store.instapay ?? "").trim() ? `<option value="INSTAPAY">${esc(t(lang, "catalog.instapay"))}</option>` : "",
		`<option value="COD">${esc(t(lang, "catalog.cod"))}</option>`,
	].join("");
	return `
<form id="f" onsubmit="return send(event)">
	<div class="total">${esc(t(lang, "catalog.total"))}: <span id="total">0</span> ${esc(t(lang, "catalog.currency"))}</div>
	<label for="phone">${esc(t(lang, "catalog.phone"))}</label>
	<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${esc(t(lang, "catalog.phone_placeholder"))}" required>
	<label for="cname">${esc(t(lang, "catalog.name"))}</label>
	<input id="cname" name="name" autocomplete="name" placeholder="${esc(t(lang, "catalog.name_placeholder"))}">
	<label for="note">${esc(t(lang, "catalog.note"))}</label>
	<textarea id="note" name="note" rows="2" autocomplete="street-address"></textarea>
	<label for="pay">${esc(t(lang, "catalog.payment"))}</label>
	<select id="pay" name="payment">${paymentOptions}</select>
	<div id="form_error" class="form-error" role="alert" aria-live="assertive"></div>
	<button class="btn" type="submit">${esc(t(lang, "catalog.submit"))}</button>
</form>
<div class="ok" id="ok" role="status" aria-live="polite"></div>
<script>
var POST_URL=${JSON.stringify(postUrl)};
var qty={};
var orderKey=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2);
function chg(code,d,max){
	qty[code]=Math.max(0,Math.min(max==null?99:max,(qty[code]||0)+d));
	document.getElementById('q_'+code).textContent=qty[code];
	var t=0;document.querySelectorAll('.card').forEach(function(c){t+=(qty[c.dataset.code]||0)*(+c.dataset.price)});
	document.getElementById('total').textContent=(t/100).toLocaleString('${numberLocale}');
}
function addText(parent,text,tag){var el=document.createElement(tag||'span');el.textContent=text;parent.appendChild(el);return el}
async function send(e){
	e.preventDefault();
	var error=document.getElementById('form_error');error.textContent='';
	var items=Object.keys(qty).filter(function(k){return qty[k]>0}).map(function(k){return {product_code:k,qty:qty[k]}});
	if(!items.length){error.textContent=${js("catalog.select_product")};return false}
	var btn=document.querySelector('.btn');btn.disabled=true;btn.textContent=${js("catalog.wait")};
	var r,d;
	try{
		r=await fetch(POST_URL,{method:'POST',headers:{'content-type':'application/json','idempotency-key':orderKey},
			body:JSON.stringify({items:items,buyer_phone:document.getElementById('phone').value,
			buyer_name:document.getElementById('cname').value,note:document.getElementById('note').value,
			pay_method:document.getElementById('pay').value})});
		d=await r.json();
	}catch(_){error.textContent=${js("catalog.network_error")};btn.disabled=false;btn.textContent=${js("catalog.submit")};return false}
	btn.disabled=false;btn.textContent=${js("catalog.submit")};
	if(!d.ok){
		error.textContent=d.error==='stock_changed'?${js("catalog.stock_changed")}:
			d.error==='payment_unavailable'?${js("catalog.payment_unavailable")}:
			r.status===429?${js("catalog.rate_limited")}:${js("catalog.order_error")};
		return false
	}
	document.getElementById('f').style.display='none';
	var ok=document.getElementById('ok');ok.replaceChildren();
	addText(ok,'🎉 '+${js("catalog.order_success")}+' #'+String(d.order_no),'b');ok.appendChild(document.createElement('br'));
	addText(ok,${js("catalog.total")}+': ');
	addText(ok,(Number(d.total_minor)/100).toLocaleString('${numberLocale}')+' '+${js("catalog.currency")},'b');
	if(d.vfcash){ok.appendChild(document.createElement('br'));addText(ok,${js("catalog.vfcash")}+': ');var vf=addText(ok,String(d.vfcash),'b');vf.dir='ltr'}
	if(d.instapay){ok.appendChild(document.createElement('br'));addText(ok,${js("catalog.instapay")}+': ');var ip=addText(ok,String(d.instapay),'b');ip.dir='ltr'}
	var wa=String(d.contact_phone||'').replace(/\\D/g,'');
	if(wa){ok.appendChild(document.createElement('br'));ok.appendChild(document.createElement('br'));var link=addText(ok,${js("catalog.payment_proof")},'a');link.className='btn';link.style.cssText='display:block;text-decoration:none';link.href='https://wa.me/'+wa+'?text='+encodeURIComponent(${js("catalog.order_number")}+' #'+String(d.order_no))}
	ok.style.display='block';window.scrollTo(0,document.body.scrollHeight);
	return false;
}
</script>`;
}

async function availableProducts(env: Env, storeId: string, lang: Locale, categoryId?: string): Promise<Record<string, unknown>[]> {
	const sql = categoryId
		? `SELECT p.id, p.product_code, COALESCE(pt.name,p.name) name, COALESCE(pt.description,p.description) description, p.price_minor, p.stock, p.image_url FROM products p
		   LEFT JOIN product_translations pt ON pt.product_id=p.id AND pt.lang=? AND pt.source_name=p.name AND pt.source_description=COALESCE(p.description,'') AND pt.translation_status IN ('machine','reviewed')
		   WHERE p.store_id = ? AND p.category_id = ? AND p.available = 1 AND p.stock > 0 ORDER BY p.created_at DESC`
		: `SELECT p.id, p.product_code, COALESCE(pt.name,p.name) name, COALESCE(pt.description,p.description) description, p.price_minor, p.stock, p.image_url FROM products p
		   LEFT JOIN product_translations pt ON pt.product_id=p.id AND pt.lang=? AND pt.source_name=p.name AND pt.source_description=COALESCE(p.description,'') AND pt.translation_status IN ('machine','reviewed')
		   WHERE p.store_id = ? AND p.available = 1 AND p.stock > 0 ORDER BY p.created_at DESC`;
	const stmt = categoryId
		? env.orderak_db.prepare(sql).bind(lang, storeId, categoryId)
		: env.orderak_db.prepare(sql).bind(lang, storeId);
	const { results } = (await stmt.all()) as { results: Record<string, unknown>[] };
	return results ?? [];
}

// ---- Store page ------------------------------------------------------------

export async function renderStorePage(env: Env, store: Store, lang: Locale): Promise<Response> {
	const pid = String(store.public_identifier);
	const { results: cats } = (await env.orderak_db
		.prepare("SELECT category_code, name FROM categories WHERE store_id = ? ORDER BY sort_order, name")
		.bind(store.id)
		.all()) as { results: Record<string, unknown>[] };

	const products = await availableProducts(env, String(store.id), lang);

	const chips = (cats ?? []).length
		? `<div class="chips">${(cats ?? [])
				.map((c) => `<a class="chip" href="/${pid}/c/${esc(c.category_code)}">${esc(c.name)}</a>`)
				.join("")}</div>`
		: "";

	const cards = products.map((p) => productCard(store, p, true, lang)).join("");
	const body = `${storeHeader(store, lang)}${chips}${
		cards || `<p style='text-align:center'>${esc(t(lang, "catalog.empty"))}</p>`
	}${products.length ? orderForm(store, lang) : ""}`;

	const revision = await loadActiveDesignSystem(env);
	const theme = revision.legacyTheme;
	const head = seoHead({
		title: `${String(store.store_name)} — أوردرك`,
		description: (store.description as string) || t(lang, "catalog.shop_description", { store: String(store.store_name) }),
		canonical: storeUrl(pid),
		image: (store.cover_url as string) || (store.logo_url as string) || null,
	}, theme);
	return pageShell(
		`${head}${designSystemFontPreload(revision.snapshot, lang === "ar" ? "arabic" : "latin")}`,
		body, theme, designSystemCss(revision.snapshot), lang, 30,
	);
}

// ---- Category page ---------------------------------------------------------

export async function renderCategoryPage(env: Env, store: Store, category: Record<string, unknown>, lang: Locale): Promise<Response> {
	const pid = String(store.public_identifier);
	const products = await availableProducts(env, String(store.id), lang, String(category.id));
	const cards = products.map((p) => productCard(store, p, true, lang)).join("");
	const body = `${storeHeader(store, lang)}
<div class="crumb"><a href="/${pid}">${esc(store.store_name)}</a> / ${esc(category.name)}</div>
<div class="sec">${esc(category.name)}</div>
${cards || `<p style='text-align:center'>${esc(t(lang, "catalog.category_empty"))}</p>`}
${products.length ? orderForm(store, lang) : ""}`;

	const revision = await loadActiveDesignSystem(env);
	const theme = revision.legacyTheme;
	const head = seoHead({
		title: `${String(category.name)} — ${String(store.store_name)}`,
		description: t(lang, "catalog.category_description", { category: String(category.name), store: String(store.store_name) }),
		canonical: `${PUBLIC_SITE_URL}/${pid}/c/${esc(category.category_code)}`,
		image: (store.cover_url as string) || (store.logo_url as string) || null,
	}, theme);
	return pageShell(
		`${head}${designSystemFontPreload(revision.snapshot, lang === "ar" ? "arabic" : "latin")}`,
		body, theme, designSystemCss(revision.snapshot), lang, 30,
	);
}

// ---- Product page ----------------------------------------------------------

export async function renderProductPage(env: Env, store: Store, product: Record<string, unknown>, lang: Locale): Promise<Response> {
	const translated = await env.orderak_db.prepare(
		`SELECT name, description FROM product_translations
		 WHERE product_id=? AND lang=? AND source_name=? AND source_description=?
		 AND translation_status IN ('machine','reviewed')`,
	).bind(product.id, lang, product.name, String(product.description ?? "")).first<{ name: string; description: string | null }>();
	if (translated) product = { ...product, name: translated.name, description: translated.description };
	const pid = String(store.public_identifier);
	const canonical = `${PUBLIC_SITE_URL}/${pid}/p/${esc(product.product_code)}`;
	const productCurrency = String(product.currency ?? "EGP") as Currency;
	const price = amountLabel(Number(product.price_minor), productCurrency, lang);
	const inStock = Number(product.stock) > 0 && Number(product.available) === 1;

	// Single-product order (reuses the shared form + one card).
	const card = inStock ? productCard(store, product, false, lang) : "";
	const soldOut = inStock ? "" : `<p style="text-align:center;color:#c00">${esc(t(lang, "catalog.sold_out"))}</p>`;

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: String(product.name),
		image: product.image_url ? [String(product.image_url)] : undefined,
		description: (product.description as string) || String(product.name),
		offers: {
			"@type": "Offer",
			priceCurrency: productCurrency,
			price: (Number(product.price_minor) / 10 ** exponentOf(productCurrency)).toFixed(exponentOf(productCurrency)),
			availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
			url: canonical,
		},
	};

	const body = `${storeHeader(store, lang)}
<div class="crumb"><a href="/${pid}">${esc(store.store_name)}</a> / ${esc(product.name)}</div>
<div class="sec">${esc(product.name)}</div>
${product.description ? `<div class="desc">${esc(product.description)}</div>` : ""}
${card}${soldOut}
${inStock ? orderForm(store, lang) : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

	const revision = await loadActiveDesignSystem(env);
	const theme = revision.legacyTheme;
	const head = seoHead({
		title: `${String(product.name)} — ${String(store.store_name)}`,
		description: (product.description as string) || `${product.name} — ${price} ${t(lang, "catalog.currency")} — ${store.store_name}.`,
		canonical,
		image: (product.image_url as string) || null,
		type: "product",
	}, theme);
	return pageShell(
		`${head}${designSystemFontPreload(revision.snapshot, lang === "ar" ? "arabic" : "latin")}`,
		body, theme, designSystemCss(revision.snapshot), lang,
	);
}

// ---- Order submission ------------------------------------------------------
// POST /{public_identifier} — buyers submit an order. Items are referenced by
// public product_code; the server resolves them within this store only.

export async function handleCatalogOrder(request: Request, env: Env, store: Store): Promise<Response> {
	let quotaReservationId: string | null = null;
	try {
		const tenant = await resolveTenantContextForStore(env, String(store.id));
		requireTenantWrite(tenant);
		const db = tenant.db;
		if (!(await storeCapabilityEnabled(env, String(store.id), "orders.accepting", true))) {
			return jsonResponse({ error: "orders_disabled" }, 403);
		}
		const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
		const idempotencyKey = /^[A-Za-z0-9._:-]{8,100}$/.test(rawIdempotencyKey)
			? rawIdempotencyKey : crypto.randomUUID();
		const successResponse = (order: { order_no: number; total_minor: number }): Response => jsonResponse({
			ok: true,
			order_no: order.order_no,
			total_minor: order.total_minor,
			contact_phone: store.whatsapp || store.phone,
			instapay: store.instapay,
			vfcash: store.vfcash,
		});
		const existingOrder = async (): Promise<{ order_no: number; total_minor: number } | null> =>
			db.prepare(
				"SELECT order_no,total_minor FROM orders WHERE store_id=? AND idempotency_key=?",
			).bind(store.id, idempotencyKey).first<{ order_no: number; total_minor: number }>();
		const replay = await existingOrder();
		if (replay) return successResponse(replay);

		// Public, unauthenticated endpoint that writes orders and decrements
		// stock — without a rate limit one client can zero a store's inventory
		// and flood the seller's app. 5 orders / minute per IP per store.
		const ip = request.headers.get("cf-connecting-ip") ?? "noip";
		if (!(await checkRateLimit(env, `order:${store.id}:${ip}`, 5, 60))) {
			return jsonResponse({ error: "rate_limited" }, 429);
		}

		const monthlyLimit = await getPlanLimit(env, String(store.id), "max_orders_per_month");
		if (env.ENTITLEMENTS_ENABLED !== "true" && monthlyLimit !== null) {
			const usage = await db.prepare(
				"SELECT COUNT(*) AS count FROM orders WHERE store_id=? AND created_at>=datetime('now','start of month')",
			).bind(store.id).first<{count:number}>();
			if (Number(usage?.count ?? 0) >= monthlyLimit) return limitReached("max_orders_per_month", monthlyLimit);
		}
		const body = (await request.json()) as Record<string, unknown>;
		const rawItems = ((body.items ?? []) as Record<string, unknown>[]).filter((i) => Number(i.qty) > 0);
		const buyerPhone = String(body.buyer_phone ?? "").replace(/\D/g, "");
		if (buyerPhone.length < 8 || buyerPhone.length > 15 || rawItems.length === 0 || rawItems.length > 50) {
			return jsonResponse({ error: "invalid" }, 400);
		}
		if (env.BUYER_PRIVACY_PEPPER) {
			const buyerHash = await keyedHash(buyerPhone, env.BUYER_PRIVACY_PEPPER);
			const restricted = await db.prepare(
				`SELECT id FROM buyer_restrictions WHERE buyer_phone_hash=? AND status='blocked' AND revoked_at IS NULL
				 AND (store_id IS NULL OR store_id=?) AND (expires_at IS NULL OR expires_at>datetime('now')) LIMIT 1`,
			).bind(buyerHash, store.id).first();
			if (restricted) return jsonResponse({ error: "buyer_restricted" }, 403);
		}

		const codes = rawItems.map((i) => String(i.product_code));
		if (new Set(codes).size !== codes.length) return jsonResponse({ error: "duplicate_products" }, 400);
		const marks = codes.map(() => "?").join(",");
		const { results: products } = (await db
			.prepare(
				`SELECT id, product_code, name, price_minor, stock FROM products
				 WHERE store_id = ? AND product_code IN (${marks})`,
			)
			.bind(store.id, ...codes)
			.all()) as { results: Record<string, unknown>[] };

		if (!products || products.length !== codes.length) {
			return jsonResponse({ error: "products" }, 400);
		}

		let total = 0;
		const lines = rawItems
			.map((i) => {
				const p = products.find((x) => x.product_code === String(i.product_code));
				if (!p) return null;
				const qty = Math.floor(Number(i.qty));
				if (qty <= 0 || qty > 999 || qty > Number(p.stock)) return null;
				total += qty * Number(p.price_minor);
				return { product_id: p.id, product_name: p.name, qty, price_minor: Number(p.price_minor) };
			})
			.filter(Boolean) as { product_id: string; product_name: string; qty: number; price_minor: number }[];

		if (lines.length !== rawItems.length) return jsonResponse({ error: "stock_changed" }, 409);

		const payMethods = ["COD"];
		if (String(store.vfcash ?? "").trim()) payMethods.push("VF_CASH");
		if (String(store.instapay ?? "").trim()) payMethods.push("INSTAPAY");
		const payMethod = String(body.pay_method ?? "COD");
		if (!payMethods.includes(payMethod)) return jsonResponse({ error: "payment_unavailable" }, 400);
		const quota = env.ENTITLEMENTS_ENABLED === "true"
			? await reserveUsage(
				env,
				String(store.id),
				"max_orders_per_month",
				1,
					idempotencyKey,
			)
			: null;
		if (quota && !quota.allowed) return entitlementLimitReached(quota.snapshot, "max_orders_per_month", 429);
		quotaReservationId = quota?.reservation_id ?? null;

		// Per-store human-friendly order number. MAX+1 races under concurrency,
		// so the unique index (migration 015) is authoritative: on a duplicate
		// we recompute once and retry the whole batch (a failed D1 batch is
		// atomic — nothing was written, so no stock is decremented twice).
		const orderId = newUuid();
		const buildStmts = (orderNo: number): D1PreparedStatement[] => {
			const stmts: D1PreparedStatement[] = [];
			stmts.push(
				db
					.prepare(
						`INSERT INTO orders (id, order_no, store_id, buyer_phone, buyer_name, pay_method, total_minor, note, idempotency_key, status)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')`,
					)
					.bind(
						orderId,
						orderNo,
						store.id,
						buyerPhone,
						String(body.buyer_name ?? "").slice(0, 40) || null,
						payMethod,
						total,
						String(body.note ?? "").slice(0, 200) || null,
						idempotencyKey,
					),
			);
			for (const l of lines) {
				stmts.push(
					db
						.prepare(
							`INSERT INTO order_items (id, order_id, product_id, product_name, qty, price_minor)
							 VALUES (?, ?, ?, ?, ?, ?)`,
						)
						.bind(newUuid(), orderId, l.product_id, l.product_name, l.qty, l.price_minor),
				);
			}
			return stmts;
		};

		const nextOrderNo = async (): Promise<number> => {
			const seqRow = (await db
				.prepare("SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM orders WHERE store_id = ?")
				.bind(store.id)
				.first()) as { n: number };
			return Number(seqRow?.n ?? 1);
		};

		let orderNo = await nextOrderNo();
		try {
			await db.batch(buildStmts(orderNo));
		} catch (error) {
			const duplicate = await existingOrder();
			if (duplicate) return successResponse(duplicate);
			const message = error instanceof Error ? error.message : String(error);
			const stillAvailable = await Promise.all(lines.map((line) => db.prepare(
				"SELECT 1 AS ok FROM products WHERE id=? AND available=1 AND stock>=?",
			).bind(line.product_id, line.qty).first<{ ok: number }>()));
			if (stillAvailable.some((row) => !row)) {
				if (quotaReservationId) await voidUsageReservation(env, quotaReservationId);
				return jsonResponse({ error: "stock_changed" }, 409);
			}
			const orderNumberConflict = message.includes("orders.store_id, orders.order_no")
				|| message.includes("idx_orders_store_orderno");
			if (!orderNumberConflict) throw error;
			console.error(JSON.stringify({
				signal: "order_number_conflict",
				store_id: store.id,
			}));
			// Concurrent order took our number. The failed D1 batch was rolled back,
			// including trigger-driven stock claims, so recomputing once is safe.
			orderNo = await nextOrderNo();
			await db.batch(buildStmts(orderNo));
		}

		return successResponse({ order_no: orderNo, total_minor: total });
	} catch (e) {
		if (quotaReservationId) await voidUsageReservation(env, quotaReservationId);
		if (e instanceof TenantWriteFencedError) {
			return jsonResponse({ error: "tenant_write_fenced", retryable: true }, 503, { "retry-after": String(e.retryAfterSeconds) });
		}
		await logError(env, "catalog_order", e, request);
		return jsonResponse({ error: "server" }, 500);
	}
}
