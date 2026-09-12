#!/usr/bin/env node
// ============================================================
// Guard the Android certificate pin set.
//
// A pin set with no renewal process is how an app bricks itself. The seller app
// pins the TLS chain for orderak.app (see
// apps/seller-android/app/src/main/res/xml/network_security_config.xml), and two
// separate things can go wrong:
//
//   1. The expiration date passes unnoticed. Android then ignores the pin set
//      and falls back to normal CA validation — the app keeps working, but the
//      control is silently gone. This is the *quiet* failure.
//
//   2. Cloudflare changes CA. orderak.app is Cloudflare-fronted and Cloudflare
//      chooses the certificate authority; it uses Google Trust Services today
//      and can move without notice. Every installed pinned build then fails
//      every request, and the only remedy is a Play release. This is the *loud*
//      failure, and it needs to be caught before a release ships, not after.
//
// TWO CHECKS, TWO PLACES, ON PURPOSE
//   The expiration check is offline and deterministic, so it runs in PR CI where
//   it can block a merge.
//
//   The live-chain check needs the network, so it runs on a schedule
//   (infra-drift) rather than in the PR path. That split is deliberate: a check
//   that a developer can make pass by re-running it is not a check, and putting
//   a network call in the merge path would have produced exactly that pressure.
//   It is never skipped on failure-to-connect — it fails, because "I could not
//   reach orderak.app" and "orderak.app changed CA" must not look the same.
//
// Usage:
//   node tooling/repository/verify-certificate-pins.mjs           # expiration only
//   node tooling/repository/verify-certificate-pins.mjs --live    # + live chain
// ============================================================

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, X509Certificate } from "node:crypto";
import { connect } from "node:tls";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configPath = join(
	repoDir, "apps", "seller-android", "app", "src", "main", "res", "xml", "network_security_config.xml",
);

/** How close to expiry is too close: a release must have time to reach devices. */
const RENEWAL_WINDOW_DAYS = 90;

/** Hosts whose chain must terminate at a pinned root. */
const PINNED_HOSTS = ["orderak.app", "api.orderak.app", "staging.orderak.app"];

function fail(message) {
	console.error(`ERROR: ${message}`);
	process.exitCode = 1;
}

async function readPinSet() {
	const xml = await readFile(configPath, "utf8");
	const expiration = /<pin-set\s+expiration="(\d{4}-\d{2}-\d{2})"/.exec(xml)?.[1];
	const pins = [...xml.matchAll(/<pin\s+digest="SHA-256">([A-Za-z0-9+/=]+)<\/pin>/g)].map((m) => m[1]);
	return { expiration, pins, xml };
}

/**
 * SHA-256 of the certificate's SubjectPublicKeyInfo, base64 — the RFC 7469 pin.
 *
 * Must be the **full SPKI**, which carries the AlgorithmIdentifier as well as
 * the key bits. tls's `certificate.pubkey` is the bare public key and hashes to
 * a different, wrong value — it looks plausible and matches nothing, which is
 * the worst way for this to be wrong. Round-tripping through X509Certificate's
 * KeyObject and exporting `spki` produces the same bytes as
 * `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der`, which is how
 * the pins in the config were generated and how Google publishes them.
 */
function spkiPin(der) {
	const spki = new X509Certificate(der).publicKey.export({ type: "spki", format: "der" });
	return createHash("sha256").update(spki).digest("base64");
}

/** Every SPKI pin in a host's presented chain, leaf first. */
function chainPins(host) {
	return new Promise((resolvePins, reject) => {
		const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => {
			const pins = [];
			let certificate = socket.getPeerCertificate(true);
			const seen = new Set();
			while (certificate && certificate.fingerprint256 && !seen.has(certificate.fingerprint256)) {
				seen.add(certificate.fingerprint256);
				if (certificate.raw) {
					pins.push({ subject: certificate.subject?.CN ?? "?", pin: spkiPin(certificate.raw) });
				}
				certificate = certificate.issuerCertificate;
			}
			socket.end();
			resolvePins(pins);
		});
		socket.setTimeout(15_000, () => { socket.destroy(new Error("timed out")); });
		socket.on("error", reject);
	});
}

const { expiration, pins } = await readPinSet();

if (!expiration) {
	fail("no pin-set expiration found. The expiration attribute is the safety valve that makes an "
		+ "un-renewed pin set stop protecting rather than stop working — it is not optional.");
} else if (pins.length < 2) {
	// RFC 7469: a backup pin is what keeps one rotation from locking every device out.
	fail(`only ${pins.length} pin(s) declared. At least one backup pin is required.`);
} else {
	const daysLeft = Math.floor((Date.parse(`${expiration}T00:00:00Z`) - Date.now()) / 86_400_000);
	if (daysLeft < 0) {
		fail(`the pin set expired ${-daysLeft} day(s) ago (${expiration}). Pinning is no longer in effect. `
			+ "See docs/runbooks/certificate-pinning.md.");
	} else if (daysLeft < RENEWAL_WINDOW_DAYS) {
		fail(`the pin set expires in ${daysLeft} day(s) (${expiration}), inside the ${RENEWAL_WINDOW_DAYS}-day `
			+ "renewal window. Verify the live chain and move the date before it lapses — a release needs "
			+ "time to reach installed devices. See docs/runbooks/certificate-pinning.md.");
	} else {
		console.log(`Pin set valid: ${pins.length} pins, expires ${expiration} (${daysLeft} days).`);
	}
}

if (process.argv.includes("--live")) {
	const pinned = new Set(pins);
	for (const host of PINNED_HOSTS) {
		try {
			const chain = await chainPins(host);
			const matched = chain.find((entry) => pinned.has(entry.pin));
			if (matched) {
				console.log(`${host}: chain terminates at a pinned certificate (${matched.subject}).`);
			} else {
				fail(`${host}: NO certificate in the presented chain matches the pin set. Every installed `
					+ "pinned build is failing, or will on its next release. Presented chain:\n"
					+ chain.map((entry) => `        ${entry.subject}  ${entry.pin}`).join("\n")
					+ "\n      See the 'If Cloudflare changes CA' section of docs/runbooks/certificate-pinning.md.");
			}
		} catch (error) {
			// Not skipped: "could not reach the host" and "the host changed CA" must
			// not produce the same green tick. A transient failure is worth a re-run;
			// a silent pass is worth an outage.
			fail(`${host}: could not verify the live chain (${error instanceof Error ? error.message : "unknown"}).`);
		}
	}
}

if (process.exitCode) {
	console.error("\nCertificate pin verification failed.");
} else {
	console.log("Certificate pins verified.");
}
