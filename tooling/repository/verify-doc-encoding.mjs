#!/usr/bin/env node
// ============================================================
// Verify documentation encoding: valid UTF-8, and no mojibake.
//
// WHY THIS EXISTS
//   The migration plan lists a "UTF-8/mojibake scan" among the documentation
//   gates. Every other gate on that list was wired; this one was not, so the
//   property held only by luck and nothing would have reported it breaking.
//
//   Mojibake is what you get when UTF-8 bytes are decoded as Latin-1 and
//   re-encoded as UTF-8: an em dash (E2 80 94) becomes "â€”", an Arabic
//   string becomes a run of "Ø" and "Ù". It survives copy-paste, so one bad
//   round-trip through an editor or a spreadsheet spreads it silently.
//
// A TRAP WORTH RECORDING
//   The obvious check — "flag any byte in C3/E2 followed by a continuation
//   byte" — matches the raw UTF-8 encoding of ordinary punctuation and reports
//   every well-formed document as broken. Writing exactly that check produced
//   five false positives on the first attempt, all of them a legitimate em
//   dash. The bytes of correct UTF-8 are not evidence of incorrect UTF-8.
//
//   So this checks two things that are actually diagnostic:
//     1. The file decodes as UTF-8 at all, strictly.
//     2. The DECODED TEXT contains sequences that essentially only arise from
//        double encoding.
//
// Usage: node tooling/repository/verify-doc-encoding.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const EXTENSIONS = [".md", ".txt", ".html"];

// Sequences that appear when UTF-8 is decoded as Latin-1 / CP1252 and
// re-encoded. Each is a real character pair no author types on purpose.
const MOJIBAKE = [
	"â€™", "â€œ", "â€", "â€“", "â€”", "â€¦", "â€˜",
	"Ã©", "Ã¨", "Ã¡", "Ã­", "Ã³", "Ãº", "Ã±", "Ã¼", "Ã¶", "Ã¤",
	"Ã‚", "Ã€", "Ãƒ", "Â«", "Â»", "Â°", "Â£", "Â©",
	// Arabic double-encoded: "الـ" becomes this shape.
	"Ø§Ù„", "Ø¨", "Ù…Ù", "Ø±Ø",
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
	.split("\n")
	.filter((f) => f && EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)));

const problems = [];

for (const file of files) {
	const bytes = readFileSync(file);

	// Strict UTF-8: TextDecoder with fatal:true throws on any invalid sequence.
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		problems.push(`${file}: not valid UTF-8`);
		continue;
	}

	// A BOM is not invalid, but it breaks tools that expect a bare "---"
	// frontmatter opener on byte 0, which is exactly what this repository's
	// frontmatter verifier reads.
	if (text.charCodeAt(0) === 0xfeff) {
		problems.push(`${file}: starts with a UTF-8 BOM`);
	}

	for (const sequence of MOJIBAKE) {
		if (text.includes(sequence)) {
			const line = text.slice(0, text.indexOf(sequence)).split("\n").length;
			problems.push(`${file}:${line}: mojibake "${sequence}" — text was decoded as Latin-1 somewhere`);
			break; // one report per file is enough to send someone to it
		}
	}
}

if (problems.length) {
	console.error("Documentation encoding problems:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(`Checked ${files.length} document(s): all valid UTF-8, no BOMs, no mojibake.`);
