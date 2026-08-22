// ============================================================
// Admin routes + panel — project control center.
// ============================================================
import { jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import { storeUrl } from "../identity/identity";
import { pickLocale } from "../../platform/localization/i18n";
import { authApp, resolveAdmin, requirePermission, auditDb, validateAdminMutation } from "./admin-auth";
import { emailAdminApp } from "../../integrations/email/adminRoutes";
import { projectApp } from "./admin-project";
import type { AdminClaims } from "../identity/auth";
import { entitlementsApp } from "./admin-entitlements";
import { operationsApp } from "./admin-operations";
import { controlPlaneApp, handleExportFile, acceptAdminInvitation } from "./admin-control-plane";
import type { AdminEnv } from "./admin-context";
import { themeApp } from "./admin-theme";

// ---- Hono app --------------------------------------------------------------
//
// The admin pipeline was a sequence of early returns: auth -> security posture
// -> mutation validation -> permission gate -> route match. Those first four
// steps are middleware, which is what Hono is actually for; the delegated
// domain handlers stay as-is behind app.all() until each is ported.
//
// `admin` and `gate` are published on the context so routes read them instead
// of closing over locals.

const app = new Hono<AdminEnv>();

// Public — invitation acceptance happens before any admin identity exists.
app.post("/api/admin/v1/auth/invitation/accept", (c) => acceptAdminInvitation(c.req.raw, c.env));

// Auth routes establish the session, so they mount before the identity
// middleware below. Their own catch-all terminates /auth/*; anything else
// falls through.
app.route("/", authApp);

// Identity + security posture + mutation validation.
app.use("*", async (c, next) => {
	const admin = await resolveAdmin(c.req.raw, c.env);
	if (!admin) return jsonResponse({ error: "unauthorized" }, 401);

	const localBearer = c.env.LOCAL_ADMIN_ENABLED === "true"
		&& c.req.header("authorization")?.startsWith("Bearer ");
	if (!localBearer) {
		const posture = await c.env.orderak_db
			.prepare("SELECT must_change_password,totp_enabled,recovery_codes_acknowledged_at FROM admin_users WHERE id=?")
			.bind(admin.sub)
			.first<{ must_change_password: number; totp_enabled: number; recovery_codes_acknowledged_at: string | null }>();
		if (!posture?.totp_enabled) return jsonResponse({ error: "mfa_enrollment_required" }, 403);
		if (!posture.recovery_codes_acknowledged_at) return jsonResponse({ error: "recovery_codes_acknowledgement_required" }, 428);
		if (posture.must_change_password) return jsonResponse({ error: "password_change_required" }, 428);
	}

	const mutationError = await validateAdminMutation(c.req.raw, c.env, admin);
	if (mutationError) return mutationError;

	const lang = pickLocale(c.req.raw, new URL(c.req.url));
	c.set("admin", admin);
	c.set("gate", (perm: string) => requirePermission(admin, perm, lang));
	await next();
});

// handleExportFile must still win over the control-plane routes, so it runs
// before the mount below — the same precedence it had at the head of the
// delegate chain.
app.use("*", async (c, next) => {
	const resp = await handleExportFile(c.req.raw, c.env, new URL(c.req.url), c.get("admin"));
	if (resp) return resp;
	await next();
});

// Every domain module is a mounted sub-app. Registration order is the
// precedence the delegate chain used to provide.
app.route("/", controlPlaneApp);
app.route("/", entitlementsApp);
// Theme terminates the chain for any unmatched /theme* path (catch-alls inside).
app.route("/", themeApp);
app.route("/", operationsApp);

app.get("/api/admin/v1/stats", (c) => c.get("gate")("dashboard:view") ?? stats(c.env));
app.get("/api/admin/v1/stores", (c) => c.get("gate")("sellers:view") ?? listStores(c.env, new URL(c.req.url)));

app.get("/api/admin/v1/plans", (c) => c.get("gate")("plans:view") ?? listPlans(c.env));
app.post("/api/admin/v1/plans", (c) => c.get("gate")("plans:manage") ?? upsertPlan(c.req.raw, c.env, c.get("admin")));
app.delete("/api/admin/v1/plans/:id", (c) => c.get("gate")("plans:manage") ?? disablePlan(c.env, c.req.param("id"), c.get("admin")));

app.get("/api/admin/v1/coupons", (c) => c.get("gate")("coupons:view") ?? listCoupons(c.env));
app.post("/api/admin/v1/coupons", (c) => c.get("gate")("coupons:manage") ?? upsertCoupon(c.req.raw, c.env, c.get("admin")));
app.delete("/api/admin/v1/coupons/:code", (c) =>
	c.get("gate")("coupons:manage") ?? deleteCoupon(c.req.raw, c.env, decodeURIComponent(c.req.param("code")), c.get("admin")));

app.get("/api/admin/v1/affiliate", (c) => c.get("gate")("affiliate:view") ?? getAffiliate(c.env));
app.post("/api/admin/v1/affiliate", (c) => c.get("gate")("affiliate:manage") ?? setAffiliate(c.req.raw, c.env, c.get("admin")));

app.get("/api/admin/v1/referrals", (c) => c.get("gate")("payouts:view") ?? listReferrals(c.env));
app.post("/api/admin/v1/referrals/:id/pay", (c) =>
	c.get("gate")("payouts:manage") ?? markReferralPaid(c.req.raw, c.env, Number(c.req.param("id")), c.get("admin")));

app.get("/api/admin/v1/ads", (c) => c.get("gate")("ads:view") ?? listAds(c.env));
app.post("/api/admin/v1/ads", (c) => c.get("gate")("ads:manage") ?? upsertAd(c.req.raw, c.env, c.get("admin")));
app.delete("/api/admin/v1/ads/:id", (c) => c.get("gate")("ads:manage") ?? deleteAd(c.env, Number(c.req.param("id")), c.get("admin")));

app.get("/api/admin/v1/audit", (c) => c.get("gate")("audit:view") ?? listAudit(c.env, new URL(c.req.url)));
app.get("/api/admin/v1/errors", (c) => c.get("gate")("audit:view") ?? listErrors(c.env, new URL(c.req.url)));

// Project and email routes are matched last, exactly as before.
app.route("/", projectApp);
app.route("/", emailAdminApp);

app.all("*", () => jsonResponse({ error: "not_found" }, 404));

app.onError((e) => {
	console.error("Admin error:", e);
	return jsonResponse({ error: "server" }, 500);
});

/**
 * Entry point kept at its original signature so callers are unaffected.
 * Returns null for non-admin paths; the Hono app handles everything else.
 */
export async function handleAdminRoutes(req: Request, env: AdminWorkerEnv, url: URL): Promise<Response | null> {
	if (!url.pathname.startsWith("/api/admin/v1/")) return null;
	return app.fetch(req, env);
}

async function listAudit(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
	const { results } = await env.orderak_db.prepare("SELECT a.id,a.admin_id,a.action,a.entity,a.entity_id,a.details_json,a.ip,a.created_at,u.email AS admin_email FROM admin_audit a LEFT JOIN admin_users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT ?").bind(limit).all();
	return jsonResponse({ ok: true, audit: results ?? [] });
}

async function listErrors(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
	const { results } = await env.orderak_db.prepare("SELECT id,context,message,stack,path,method,ip,created_at FROM error_logs ORDER BY id DESC LIMIT ?").bind(limit).all();
	return jsonResponse({ ok: true, errors: results ?? [] });
}

async function stats(env: AdminWorkerEnv): Promise<Response> {
	const activeSubs = (await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE status='active' AND plan_id!='free'").first()) as {c:number};
	const totalSellers = (await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM sellers").first()) as {c:number};
	const byPlan = (await env.orderak_db.prepare("SELECT plan_id,COUNT(*) AS c FROM subscriptions WHERE status='active' GROUP BY plan_id").all()).results;
	const revenue = (await env.orderak_db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS r FROM subscriptions WHERE status='active'").first()) as {r:number};
	const couponUses = (await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM coupon_uses").first()) as {c:number};
	const pendingPayouts = (await env.orderak_db.prepare("SELECT COALESCE(SUM(commission_minor),0) AS r FROM referrals WHERE status='qualified'").first()) as {r:number};
	return jsonResponse({ok:true,active_paid_subscriptions:activeSubs.c,total_sellers:totalSellers.c,subscriptions_by_plan:byPlan,monthly_revenue_minor:revenue.r,coupon_uses:couponUses.c,pending_commission_minor:pendingPayouts.r});
}

async function listStores(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
	const q = (url.searchParams.get("q")??"").trim();
	const base = "SELECT s.id,s.store_code,s.public_identifier,s.country_code,s.store_name,s.status,s.created_at,(SELECT COUNT(*) FROM products WHERE store_id=s.id) AS product_count,(SELECT COUNT(*) FROM categories WHERE store_id=s.id) AS category_count FROM sellers s";
	const stmt = q ? env.orderak_db.prepare(base+" WHERE s.store_name LIKE ? OR s.store_code LIKE ? OR s.public_identifier LIKE ? ORDER BY s.created_at DESC LIMIT ?").bind('%'+q+'%','%'+q+'%','%'+q+'%',limit) : env.orderak_db.prepare(base+" ORDER BY s.created_at DESC LIMIT ?").bind(limit);
	const {results} = (await stmt.all()) as {results:Record<string,unknown>[]};
	return jsonResponse({ok:true,stores:(results??[]).map(r=>({...r,store_url:storeUrl(String(r.public_identifier))}))});
}

async function listPlans(env: AdminWorkerEnv): Promise<Response> {
	const {results:plans} = await env.orderak_db.prepare("SELECT * FROM plans ORDER BY sort_order").all();
	const planRows = plans as Record<string,unknown>[];
	// One query for every plan's features, not one per plan. The public twin
	// (listPublicPlans in billing.ts) was fixed for this and this one was not, so
	// the admin list stayed at N+1 while the seller-facing list did not.
	const featuresByPlan = new Map<unknown, Record<string,unknown>[]>();
	if (planRows.length) {
		const marks = planRows.map(() => "?").join(",");
		const {results:features} = await env.orderak_db
			.prepare(`SELECT id,plan_id,feature_key,name,description,enabled FROM plan_features WHERE plan_id IN (${marks})`)
			.bind(...planRows.map((plan) => plan.id))
			.all();
		for (const feature of features as Record<string,unknown>[]) {
			const {plan_id, ...rest} = feature;
			const list = featuresByPlan.get(plan_id) ?? [];
			list.push(rest);
			featuresByPlan.set(plan_id, list);
		}
	}
	return jsonResponse({ok:true,plans:planRows.map((plan) => ({...plan,features:featuresByPlan.get(plan.id) ?? []}))});
}

async function upsertPlan(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(()=>({}))) as Record<string,unknown>;
	const id = String(b.id??"").trim().toLowerCase();
	if(!/^[a-z0-9_-]{2,40}$/.test(id)) return jsonResponse({error:"invalid_plan_id"},400);
	const name = String(b.name??id);
	const price = Math.max(0,Math.floor(Number(b.price_minor)||0));
	const currency = String(b.currency??"EGP");
	const interval = b.interval==="yearly"?"yearly":"monthly";
	const adsE = b.ads_enabled?1:0;
	const active = b.active===false||b.active===0?0:1;
	const so = Math.floor(Number(b.sort_order)||0);
	const nv = (v:unknown):number|null=>(v===null||v===undefined||v===""||v===false)?null:Math.floor(Math.max(-1,Number(v)||0));
	await env.orderak_db.prepare("INSERT INTO plans(id,name,price_minor,currency,interval,ads_enabled,active,sort_order,max_categories,max_products,max_orders_per_month,max_ai_requests_per_month,max_team_members,custom_domain_enabled,analytics_enabled,priority_support_enabled,multi_device_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_minor=excluded.price_minor,currency=excluded.currency,interval=excluded.interval,ads_enabled=excluded.ads_enabled,active=excluded.active,sort_order=excluded.sort_order,max_categories=excluded.max_categories,max_products=excluded.max_products,max_orders_per_month=excluded.max_orders_per_month,max_ai_requests_per_month=excluded.max_ai_requests_per_month,max_team_members=excluded.max_team_members,custom_domain_enabled=excluded.custom_domain_enabled,analytics_enabled=excluded.analytics_enabled,priority_support_enabled=excluded.priority_support_enabled,multi_device_enabled=excluded.multi_device_enabled")
		.bind(id,name,price,currency,interval,adsE,active,so,nv(b.max_categories),nv(b.max_products),nv(b.max_orders_per_month),nv(b.max_ai_requests_per_month),nv(b.max_team_members),b.custom_domain_enabled?1:0,b.analytics_enabled?1:0,b.priority_support_enabled?1:0,b.multi_device_enabled?1:0).run();
	if(Array.isArray(b.features)){await env.orderak_db.prepare("DELETE FROM plan_features WHERE plan_id=?").bind(id).run();for(const f of b.features as Record<string,unknown>[]){await env.orderak_db.prepare("INSERT OR REPLACE INTO plan_features(plan_id,feature_key,name,description,enabled) VALUES(?,?,?,?,?)").bind(id,String(f.feature_key??"").slice(0,40),String(f.name??""),String(f.description??""),f.enabled===false||f.enabled===0?0:1).run();}}
	await auditDb(env, admin, "admin.plan_upserted", { entity: "plan", entity_id: id }, request);
	return jsonResponse({ok:true,id});
}

async function disablePlan(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("UPDATE plans SET active=0 WHERE id=?").bind(id).run();
	await auditDb(env, admin, "admin.plan_disabled", { entity: "plan", entity_id: id });
	return jsonResponse({ok:true,disabled:id});
}

async function listCoupons(env: AdminWorkerEnv): Promise<Response> { const {results} = await env.orderak_db.prepare("SELECT c.*,(SELECT COUNT(*) FROM coupon_uses u WHERE u.coupon_code=c.code) AS uses FROM coupons c ORDER BY c.created_at DESC").all(); return jsonResponse({ok:true,coupons:results??[]}); }
async function upsertCoupon(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> { const b = (await request.json().catch(()=>({}))) as Record<string,unknown>; const code = String(b.code??"").trim().toUpperCase(); if(!code) return jsonResponse({error:"code_required"},400); const type = b.discount_type==="fixed"?"fixed":"percentage"; const value = Math.max(0,Math.floor(Number(b.value)||0)); if(type==="percentage"&&value>100) return jsonResponse({error:"percentage_over_100"},400); const expires = b.expires_at?String(b.expires_at):null; const maxUses = Math.max(0,Math.floor(Number(b.max_uses)||0)); const active = b.active===false||b.active===0?0:1; await env.orderak_db.prepare("INSERT INTO coupons(code,discount_type,value,expires_at,max_uses,active) VALUES(?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET discount_type=excluded.discount_type,value=excluded.value,expires_at=excluded.expires_at,max_uses=excluded.max_uses,active=excluded.active").bind(code,type,value,expires,maxUses,active).run(); await auditDb(env,admin,"admin.coupon_upserted",{entity:"coupon",entity_id:code},request); return jsonResponse({ok:true,code}); }
async function deleteCoupon(request: Request, env: AdminWorkerEnv, code: string, admin: AdminClaims): Promise<Response> { await env.orderak_db.prepare("UPDATE coupons SET active=0 WHERE code=?").bind(code.toUpperCase()).run(); await auditDb(env,admin,"admin.coupon_disabled",{entity:"coupon",entity_id:code},request); return jsonResponse({ok:true,disabled:code}); }

async function getAffiliate(env: AdminWorkerEnv): Promise<Response> { const s = await env.orderak_db.prepare("SELECT * FROM affiliate_settings WHERE id=1").first(); return jsonResponse({ok:true,settings:s}); }
async function setAffiliate(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> { const b = (await request.json().catch(()=>({}))) as Record<string,unknown>; await env.orderak_db.prepare("INSERT INTO affiliate_settings(id,commission_type,commission_value,referral_bonus_type,referral_bonus_value,min_payout_minor,payout_info,updated_at) VALUES(1,?,?,?,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET commission_type=excluded.commission_type,commission_value=excluded.commission_value,referral_bonus_type=excluded.referral_bonus_type,referral_bonus_value=excluded.referral_bonus_value,min_payout_minor=excluded.min_payout_minor,payout_info=excluded.payout_info,updated_at=datetime('now')").bind(b.commission_type==="fixed"?"fixed":"percentage",Math.max(0,Math.floor(Number(b.commission_value)||0)),b.referral_bonus_type==="fixed"?"fixed":"percentage",Math.max(0,Math.floor(Number(b.referral_bonus_value)||0)),Math.max(0,Math.floor(Number(b.min_payout_minor)||0)),String(b.payout_info??"")).run(); await auditDb(env,admin,"admin.affiliate_updated",{entity:"affiliate_settings",entity_id:1},request); return jsonResponse({ok:true}); }
async function listReferrals(env: AdminWorkerEnv): Promise<Response> { const {results} = await env.orderak_db.prepare("SELECT r.*,s1.phone AS referrer_phone,s2.phone AS referred_phone FROM referrals r LEFT JOIN sellers s1 ON s1.id=r.referrer_id LEFT JOIN sellers s2 ON s2.id=r.referred_id ORDER BY r.id DESC LIMIT 200").all(); return jsonResponse({ok:true,referrals:results??[]}); }
async function markReferralPaid(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> { const result=await env.orderak_db.prepare("UPDATE referrals SET status='paid' WHERE id=? AND status='qualified'").bind(id).run(); if(!result.meta.changes)return jsonResponse({error:"not_qualified_or_not_found"},409); await auditDb(env,admin,"admin.referral_paid",{entity:"referral",entity_id:id},request); return jsonResponse({ok:true,paid:id}); }

async function listAds(env: AdminWorkerEnv): Promise<Response> { const {results} = await env.orderak_db.prepare("SELECT a.*,(SELECT COUNT(*) FROM ad_impressions WHERE ad_id=a.id AND kind='impression') AS impressions,(SELECT COUNT(*) FROM ad_impressions WHERE ad_id=a.id AND kind='click') AS clicks FROM ads a ORDER BY a.id DESC").all(); return jsonResponse({ok:true,ads:results??[]}); }
async function upsertAd(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(()=>({}))) as Record<string,unknown>;
	const title = String(b.title??"").trim();
	const img = String(b.image_url??"").trim();
	if(!title||!img) return jsonResponse({error:"title_and_image_required"},400);
	const isHttps = (value: string): boolean => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
	if (!isHttps(img)) return jsonResponse({ error: "https_image_required" }, 400);
	const click = b.click_url ? String(b.click_url).trim() : null;
	if (click && !isHttps(click)) return jsonResponse({ error: "https_click_url_required" }, 400);
	const type = ["banner","native"].includes(String(b.type))?String(b.type):"banner";
	const targetPlan = String(b.target_plan??"free").slice(0,40);
	const frequency = Math.max(1,Math.floor(Number(b.frequency)||1));
	const weight = Math.max(0,Math.floor(Number(b.weight)||1));
	const active = b.active===false||b.active===0?0:1;
	const startsAt = b.starts_at ? String(b.starts_at) : null;
	const endsAt = b.ends_at ? String(b.ends_at) : null;
	const titleI18n = b.title_i18n ? String(b.title_i18n) : null;
	const imageI18n = b.image_url_i18n ? String(b.image_url_i18n) : null;
	const id = b.id?Number(b.id):0;
	if(id){
		await env.orderak_db.prepare("UPDATE ads SET title=?,title_i18n=?,image_url=?,image_url_i18n=?,click_url=?,type=?,target_plan=?,frequency=?,weight=?,starts_at=?,ends_at=?,active=? WHERE id=?")
			.bind(title,titleI18n,img,imageI18n,click,type,targetPlan,frequency,weight,startsAt,endsAt,active,id).run();
		await auditDb(env, admin, "admin.ad_updated", { entity: "ad", entity_id: id }, request);
		return jsonResponse({ok:true,id});
	}
	const row = await env.orderak_db.prepare("INSERT INTO ads(title,title_i18n,image_url,image_url_i18n,click_url,type,target_plan,frequency,weight,starts_at,ends_at,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
		.bind(title,titleI18n,img,imageI18n,click,type,targetPlan,frequency,weight,startsAt,endsAt,active).first<Record<string,unknown>>();
	await auditDb(env, admin, "admin.ad_created", { entity: "ad", entity_id: row?.id }, request);
	return jsonResponse({ok:true,id:row?.id},201);
}
async function deleteAd(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> { if(!id) return jsonResponse({error:"id_required"},400); await env.orderak_db.prepare("UPDATE ads SET active=0 WHERE id=?").bind(id).run(); await auditDb(env,admin,"admin.ad_disabled",{entity:"ad",entity_id:id}); return jsonResponse({ok:true,disabled:id}); }
