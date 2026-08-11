import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	LEGACY_DEFAULT_THEME,
	generateDesignSystem,
} from "../src/domains/design/design-system";

const workspace = resolve(process.cwd(), "..", "..");
const fixturePath = resolve(workspace, "design", "design-system.default.json");
const androidContractPath = resolve(
	workspace,
	"apps",
	"seller-android",
	"app",
	"src",
	"main",
	"java",
	"app",
	"orderak",
	"seller",
	"core",
	"ui",
	"theme",
	"DesignSystemContract.kt",
);

async function main() {
const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
const fixture = `${JSON.stringify({
	$comment: "Canonical compiled fallback. Generated; do not edit by hand.",
	source: DEFAULT_DESIGN_SYSTEM_SOURCE,
	snapshot,
	legacyProjection: LEGACY_DEFAULT_THEME,
}, null, 2)}\n`;
const kotlin = `package app.orderak.seller.core.ui.theme

/** Generated fallback identity checked by verifyDesignSystemContract. */
internal object DesignSystemContract {
    const val SCHEMA_VERSION = 2
    const val GENERATOR_VERSION = "${snapshot.generatorVersion}"
    const val DEFAULT_FALLBACK_HASH = "${snapshot.contentHash}"
}
`;

if (process.argv.includes("--write")) {
	await writeFile(fixturePath, fixture);
	await writeFile(androidContractPath, kotlin);
	console.log(`Wrote ${fixturePath}`);
} else {
	const currentFixture = await readFile(fixturePath, "utf8").catch(() => "");
	const currentKotlin = await readFile(androidContractPath, "utf8").catch(() => "");
	if (currentFixture !== fixture || currentKotlin !== kotlin) {
		console.error("Generated design-system fallback drift detected. Run npm run design-system:generate.");
		process.exitCode = 1;
	} else {
		console.log(`Design-system fixture is current (${snapshot.contentHash}).`);
	}
}
}

void main();
