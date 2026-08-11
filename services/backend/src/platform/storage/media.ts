// ============================================================
// Media module — store logo / cover / product images on R2.
//
//   POST /api/v1/media/upload   (auth)  multipart { file, kind } -> { url }
//   GET  /media/{key}                 public, cached, streamed from R2
//
// Public image URLs are served from the public site (orderak.app/media/...) so
// catalog pages can embed them without cross-origin issues.
// ============================================================

import { jsonResponse } from "../http/shared";
import { PUBLIC_SITE_URL, newUuid } from "../../domains/identity/identity";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_KINDS = new Set(["logo", "cover", "product"]);

/**
 * Image formats recognised by their leading bytes.
 *
 * The uploaded file's declared `type` is whatever the client chose to send and
 * is never consulted for this decision. Previously it was the only check, so
 * arbitrary bytes labelled image/png were accepted, stored, and later served
 * back with that same claimed content type. The `nosniff` header on the serving
 * path limits what a browser will do with such an object, but "the browser
 * probably will not execute it" is a mitigation, not a validation — nothing
 * stopped the bucket filling with content that was not an image at all.
 *
 * Detection is by signature, and the detected type is what gets stored. A
 * client that lies, or that sends application/octet-stream because it does not
 * know, both end up with the correct content type on the object.
 *
 * SVG is deliberately absent. It is XML, it can carry script, and no signature
 * check can make it safe to serve from the same origin as the storefront.
 */
const IMAGE_SIGNATURES: ReadonlyArray<{
	type: string;
	ext: string;
	matches: (bytes: Uint8Array) => boolean;
}> = [
	{
		type: "image/jpeg",
		ext: "jpg",
		matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		type: "image/png",
		ext: "png",
		// \x89PNG\r\n\x1a\n — the trailing bytes catch transfers that mangled
		// line endings, which is exactly what they were designed for.
		matches: (b) =>
			b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
			&& b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
	},
	{
		type: "image/gif",
		ext: "gif",
		// "GIF87a" or "GIF89a"
		matches: (b) =>
			b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
			&& (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
	},
	{
		type: "image/webp",
		ext: "webp",
		// "RIFF" .... "WEBP" — the size field sits between the two markers, so
		// both have to be checked or any RIFF container would pass.
		matches: (b) =>
			b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
			&& b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
	},
];

/** Longest signature is WebP's, needing bytes 0..11. */
const SIGNATURE_BYTES = 12;

/** Identify an image by its leading bytes, or null when it is not one we serve. */
export function detectImageType(bytes: Uint8Array): { type: string; ext: string } | null {
	if (bytes.byteLength < SIGNATURE_BYTES) return null;
	const found = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes));
	return found ? { type: found.type, ext: found.ext } : null;
}

/** GET /media/{key} — stream an object from R2 with long-lived caching. */
export async function serveMedia(env: Env, key: string): Promise<Response> {
	if (!key) return new Response("Not found", { status: 404 });
	const obj = await env.orderak_media.get(key);
	if (!obj || !obj.body) return new Response("Not found", { status: 404 });
	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set("etag", obj.httpEtag);
	headers.set("cache-control", "public, max-age=31536000, immutable");
	// Uploaded bytes are attacker-supplied; never let browsers sniff them into
	// a different (potentially active) content type.
	headers.set("x-content-type-options", "nosniff");
	return new Response(obj.body, { headers });
}

/**
 * POST /api/v1/media/upload — persist an uploaded image under this store's prefix
 * and return its public URL. `storeId` is the authenticated store's UUID.
 */
export async function uploadMedia(request: Request, env: Env, storeId: string): Promise<Response> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return jsonResponse({ error: "invalid_form" }, 400);
	}
	const file = form.get("file");
	if (!(file instanceof File)) return jsonResponse({ error: "file_required" }, 400);
	if (file.size <= 0 || file.size > MAX_BYTES) return jsonResponse({ error: "file_too_large" }, 400);

	// Read the bytes rather than streaming them straight through: the format has
	// to be established before anything is written, and the request body is
	// already buffered upstream by enforceRequestBodyLimit, so this does not
	// change the memory profile.
	const bytes = new Uint8Array(await file.arrayBuffer());
	const detected = detectImageType(bytes);
	if (!detected) return jsonResponse({ error: "unsupported_type" }, 415);

	const kindRaw = String(form.get("kind") ?? "product");
	const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : "product";
	const key = `stores/${storeId}/${kind}-${newUuid()}.${detected.ext}`;

	// Both the extension and the stored content type come from the detected
	// format, never from what the client claimed.
	await env.orderak_media.put(key, bytes, {
		httpMetadata: { contentType: detected.type },
	});

	return jsonResponse({ ok: true, key, url: `${PUBLIC_SITE_URL}/media/${key}` });
}
