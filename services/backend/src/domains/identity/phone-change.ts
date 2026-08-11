import { verifyFirebasePhone } from "../stores/api-store";
import { playAccountHash, validE164 } from "./identity";
import { authSeller, hashSecret, jsonResponse, methodNotAllowed, readCreds } from "../../platform/http/shared";

type Body = Record<string, unknown>;
const CHALLENGE_TTL_SECONDS = 600;
const FRESH_PROOF_SECONDS = 300;

function fresh(identity: { authTime?: number }): boolean {
	return identity.authTime != null && Math.floor(Date.now() / 1000) - identity.authTime <= FRESH_PROOF_SECONDS;
}

function disabled(): Response {
	return jsonResponse({ error: "phone_change_disabled" }, 503);
}

export async function handlePhoneChangeRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
	if (url.pathname !== "/api/v1/auth/phone-change/challenges"
		&& url.pathname !== "/api/v1/auth/phone-change/complete") return null;
	if (request.method !== "POST") return methodNotAllowed("POST");
	if (env.PHONE_CHANGE_ENABLED !== "true") return disabled();
	if (!env.FIREBASE_WEB_API_KEY) return jsonResponse({ error: "firebase_not_configured" }, 503);
	const body = await request.json<Body>().catch(() => ({} as Body));
	if (url.pathname.endsWith("/complete")) {
		const replayId = String(body.challenge_id ?? "");
		const replayToken = String(body.challenge_token ?? "");
		if (replayId && replayToken) {
			const replay = await env.orderak_db.prepare(
				"SELECT consumed_at FROM phone_change_challenges WHERE id=? AND challenge_token_hash=?",
			).bind(replayId, await playAccountHash(replayToken)).first<{ consumed_at: string | null }>();
			if (replay?.consumed_at) return jsonResponse({ error: "replayed_challenge" }, 409);
		}
	}

	const { phone, secret } = readCreds(request, url);
	const seller = await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);
	if (seller.status && seller.status !== "active") {
		return jsonResponse({ error: "account_restricted", status: seller.status }, 403);
	}

	if (url.pathname.endsWith("/challenges")) {
		const newPhone = String(body.new_phone ?? "");
		const currentProof = await verifyFirebasePhone(env, String(body.id_token ?? ""), phone);
		if (!currentProof || !fresh(currentProof)) return jsonResponse({ error: "current_proof_mismatch" }, 401);
		if (!validE164(newPhone) || newPhone === phone) return jsonResponse({ error: "new_phone_mismatch" }, 400);
		const active = await env.orderak_db.prepare(
			`SELECT provider_subject FROM seller_auth_identities
			 WHERE seller_id=? AND provider='firebase_phone' AND status='active'`,
		).bind(seller.id).first<{ provider_subject: string }>();
		if (!active || active.provider_subject !== currentProof.uid) {
			return jsonResponse({ error: "current_proof_mismatch" }, 401);
		}
		const used = await env.orderak_db.prepare(
			"SELECT 1 used FROM seller_auth_identities WHERE verified_phone_e164=? AND status='active'",
		).bind(newPhone).first();
		if (used) return jsonResponse({ error: "phone_already_used" }, 409);

		const id = crypto.randomUUID();
		const token = crypto.randomUUID();
		await env.orderak_db.prepare(
			`INSERT INTO phone_change_challenges(
			 id,challenge_token_hash,seller_id,current_phone_e164,new_phone_e164,current_provider_subject,expires_at)
			 VALUES(?,?,?,?,?,?,datetime('now',?))`,
		).bind(id, await playAccountHash(token), seller.id, phone, newPhone, currentProof.uid, `+${CHALLENGE_TTL_SECONDS} seconds`).run();
		return jsonResponse({ ok: true, challenge_id: id, challenge_token: token, expires_in_seconds: CHALLENGE_TTL_SECONDS });
	}

	const challengeId = String(body.challenge_id ?? "");
	const challengeToken = String(body.challenge_token ?? "");
	const replacementSecret = String(body.replacement_device_secret ?? "");
	if (!challengeId || !challengeToken || !replacementSecret) {
		return jsonResponse({ error: "invalid_challenge" }, 400);
	}
	const challenge = await env.orderak_db.prepare(
		`SELECT id,seller_id,current_phone_e164,new_phone_e164,current_provider_subject,expires_at,consumed_at
		 FROM phone_change_challenges WHERE id=? AND challenge_token_hash=?`,
	).bind(challengeId, await playAccountHash(challengeToken)).first<{
		id: string; seller_id: string; current_phone_e164: string; new_phone_e164: string;
		current_provider_subject: string; expires_at: string; consumed_at: string | null;
	}>();
	if (!challenge || challenge.seller_id !== String(seller.id) || challenge.current_phone_e164 !== phone) {
		return jsonResponse({ error: "invalid_challenge" }, 400);
	}
	if (challenge.consumed_at) return jsonResponse({ error: "replayed_challenge" }, 409);
	if (Date.parse(`${challenge.expires_at.replace(" ", "T")}Z`) <= Date.now()) {
		return jsonResponse({ error: "expired_challenge" }, 410);
	}
	const newProof = await verifyFirebasePhone(env, String(body.id_token ?? ""), challenge.new_phone_e164);
	if (!newProof || !fresh(newProof)) return jsonResponse({ error: "new_phone_mismatch" }, 401);
	const replacementHash = await hashSecret(replacementSecret);
	try {
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`UPDATE phone_change_challenges SET consumed_at=datetime('now')
				 WHERE id=? AND consumed_at IS NULL AND expires_at>datetime('now')`,
			).bind(challenge.id),
			env.orderak_db.prepare(
				`UPDATE seller_auth_identities
				 SET status='superseded',superseded_at=datetime('now'),updated_at=datetime('now')
				 WHERE seller_id=? AND provider='firebase_phone' AND status='active'
				 AND provider_subject=? AND verified_phone_e164=?`,
			).bind(seller.id, challenge.current_provider_subject, challenge.current_phone_e164),
			env.orderak_db.prepare(
				`INSERT INTO seller_auth_identities(
				 id,seller_id,provider,provider_subject,verified_phone_e164,status)
				 VALUES(?,?,'firebase_phone',?,?,'active')`,
			).bind(crypto.randomUUID(), seller.id, newProof.uid, challenge.new_phone_e164),
			env.orderak_db.prepare(
				"UPDATE sellers SET phone=?,firebase_uid=?,secret=?,updated_at=datetime('now') WHERE id=? AND phone=?",
			).bind(challenge.new_phone_e164, newProof.uid, replacementHash, seller.id, challenge.current_phone_e164),
			env.orderak_db.prepare("DELETE FROM seller_devices WHERE seller_id=?").bind(seller.id),
		]);
	} catch (error) {
		const current = await env.orderak_db.prepare(
			"SELECT consumed_at FROM phone_change_challenges WHERE id=?",
		).bind(challenge.id).first<{ consumed_at: string | null }>();
		if (current?.consumed_at) return jsonResponse({ error: "replayed_challenge" }, 409);
		const message = error instanceof Error ? error.message : "";
		if (message.includes("UNIQUE")) return jsonResponse({ error: "phone_already_used" }, 409);
		throw error;
	}
	return jsonResponse({ ok: true, phone: challenge.new_phone_e164, prior_devices_revoked: true });
}
