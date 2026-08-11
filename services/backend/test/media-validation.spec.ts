import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { createSchema, registerStore, authHeaders } from "./helpers";
import { detectImageType } from "../src/platform/storage/media";

/**
 * Uploads used to be accepted on the strength of the client-supplied MIME type
 * alone, so arbitrary bytes labelled image/png were stored and served back
 * under that claimed type. These assert that the bytes decide.
 */

/** Minimal but genuinely well-formed signatures for each accepted format. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
const WEBP = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

function upload(bytes: Uint8Array, filename: string, claimedType: string, headers: Record<string, string>) {
	const form = new FormData();
	form.append("file", new File([bytes], filename, { type: claimedType }), filename);
	form.append("kind", "product");

	// authHeaders() sets content-type: application/json, which would override the
	// multipart boundary the FormData body needs and make formData() reject the
	// request before any of this is reached. Credentials only; let the body set
	// its own content type.
	const { "content-type": _ignored, ...credentials } = headers;

	return SELF.fetch("https://api.orderak.app/api/v1/media/upload", {
		method: "POST",
		headers: credentials,
		body: form,
	});
}

describe("media upload validates the bytes, not the label", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("recognises each accepted format by signature", () => {
		expect(detectImageType(PNG)).toEqual({ type: "image/png", ext: "png" });
		expect(detectImageType(JPEG)).toEqual({ type: "image/jpeg", ext: "jpg" });
		expect(detectImageType(GIF)).toEqual({ type: "image/gif", ext: "gif" });
		expect(detectImageType(WEBP)).toEqual({ type: "image/webp", ext: "webp" });
	});

	it("rejects content that is not an image whatever it claims to be", () => {
		const html = new TextEncoder().encode("<html><script>alert(1)</script>");
		expect(detectImageType(html)).toBeNull();

		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
		expect(detectImageType(svg)).toBeNull();

		// A RIFF container that is not WebP must not pass on its first four bytes.
		const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
		expect(detectImageType(wav)).toBeNull();
	});

	it("rejects a file too short to carry a signature", () => {
		expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
	});

	it("refuses an upload whose bytes are not an image, even labelled image/png", async () => {
		const store = await registerStore();
		const payload = new TextEncoder().encode("<html><script>alert(document.cookie)</script></html>");

		const response = await upload(payload, "evil.png", "image/png", authHeaders(store));
		expect(response.status).toBe(415);
		// Errors are RFC 9457 problem+json, so the machine-readable field is `code`.
		expect(await response.json()).toMatchObject({ code: "unsupported_type" });
	});

	it("accepts a real image and stores it under the detected type", async () => {
		const store = await registerStore();

		// Claim the wrong type on purpose: the bytes are PNG, the label says JPEG.
		const response = await upload(PNG, "photo.jpg", "image/jpeg", authHeaders(store));
		expect(response.status).toBe(200);

		const body = await response.json<{ key: string; url: string }>();
		// The extension follows the bytes, not the filename or the claimed type.
		expect(body.key).toMatch(/\.png$/);

		const served = await SELF.fetch(`https://orderak.app/media/${body.key}`);
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toBe("image/png");
		expect(served.headers.get("x-content-type-options")).toBe("nosniff");
	});
});
