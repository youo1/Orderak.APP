// ============================================================
// Inbound email handler — Cloudflare Email Routing → Worker.
//
// Cloudflare delivers each message addressed to a configured address
// (e.g. support@orderak.app) to the Worker's `email()` entrypoint, which
// calls handleInboundEmail(). We:
//   1. Parse the raw MIME message (postal-mime) → subject/text/html.
//   2. Store one row in `inbound_emails` (visible in the admin "Inbox" tab).
//   3. Optionally re-forward a copy to FORWARD_TO (a personal inbox) so you
//      get both an in-app copy AND a normal email. Forwarding only works to
//      addresses verified in the Cloudflare Email Routing dashboard.
//
// Adding more inbound addresses needs no code change: point additional
// Email Routing rules (or a catch-all) at this same Worker; `message.to`
// tells us which address each message hit.
// ============================================================

import PostalMime from "postal-mime";
import { recordInbound } from "./repository";

const MAX_INBOUND_BYTES = 10 * 1024 * 1024;

// The inbound message type (`ForwardableEmailMessage`) is provided globally by
// the Cloudflare Workers runtime types (worker-configuration.d.ts).

/** Read the raw message stream into a single Uint8Array for parsing. */

async function readStream(stream: ReadableStream<Uint8Array>, size: number): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			total += value.length;
		}
	}
	const out = new Uint8Array(total || size);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/**
 * Process one inbound message: parse → store → (optionally) forward a copy.
 * Never throws to the runtime — a parse/store failure is logged and the raw
 * message is still forwarded if FORWARD_TO is set, so mail is never lost.
 */
export async function handleInboundEmail(
	message: ForwardableEmailMessage,
	env: Env,
): Promise<void> {
	const forwardTo = (env.FORWARD_TO ?? "").trim();
	let forwarded = false;

		// Forward a copy first so delivery to your inbox is never blocked by a
	// parse/DB hiccup. If FORWARD_TO is not a verified destination (or forwarding
	// is otherwise not allowed), forward() throws and we skip — the stored copy in
	// the admin panel is the fallback.
	if (forwardTo) {
		try {
			await message.forward(forwardTo);
			forwarded = true;
		} catch (err) {
			console.error("inbound forward failed:", err);
		}
	}

	try {
		if (message.rawSize > MAX_INBOUND_BYTES) {
			console.error(JSON.stringify({ signal: "inbound_email_too_large", size: message.rawSize }));
			await recordInbound(env, {
				to: message.to || "",
				from: message.from || "",
				subject: message.headers.get("subject") ?? "(message too large to parse)",
				text: "",
				html: "",
				messageId: message.headers.get("message-id"),
				size: message.rawSize,
				forwarded,
			});
			return;
		}
		const raw = await readStream(message.raw, message.rawSize);
		const parsed = await PostalMime.parse(raw);

		await recordInbound(env, {
			to: message.to || parsed.to?.[0]?.address || "",
			from: message.from || parsed.from?.address || "",
			subject: parsed.subject ?? "",
			text: parsed.text ?? "",
			html: parsed.html ?? "",
			messageId: parsed.messageId ?? message.headers.get("message-id"),
			size: message.rawSize,
			forwarded,
		});
	} catch (err) {
		console.error("inbound store failed:", err);
		// Record a minimal row so the message is at least visible in the panel.
		try {
			await recordInbound(env, {
				to: message.to || "",
				from: message.from || "",
				subject: message.headers.get("subject") ?? "(unparsed message)",
				text: "",
				html: "",
				messageId: message.headers.get("message-id"),
				size: message.rawSize,
				forwarded,
			});
		} catch (err2) {
			console.error("inbound minimal store failed:", err2);
		}
	}
}
