import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DESIGN_SYSTEM_GENERATOR_VERSION,
	DESIGN_SYSTEM_SCHEMA_VERSION,
	generateDesignSystem,
	type DesignSystemOverrides,
	type DesignSystemSource,
	type LegacyTheme,
} from "../src/domains/design/design-system";

interface RecoveryInput {
	baseRevisionId: number;
	source: DesignSystemSource;
	overrides?: DesignSystemOverrides;
	legacyProjection: LegacyTheme;
}

const quote = (value: unknown): string => `'${JSON.stringify(value).replaceAll("'", "''")}'`;

async function main(): Promise<void> {
	const inputPath = process.argv[2];
	const outputPath = process.argv[3];
	if (!inputPath || !outputPath) {
		throw new Error("Usage: generate-design-system-recovery-sql <input.json> <output.sql>");
	}
	const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as RecoveryInput;
	if (!Number.isInteger(input.baseRevisionId) || input.baseRevisionId < 1) {
		throw new Error("A positive baseRevisionId is required.");
	}
	const snapshot = await generateDesignSystem(input.source, input.overrides ?? {});
	if (!snapshot.validation.valid) throw new Error("Recovery snapshot failed validation.");
	const hash = snapshot.contentHash;
	const sql = [
		`INSERT INTO design_system_revisions`,
		` (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,created_by,rollback_of_revision_id)`,
		` VALUES (${DESIGN_SYSTEM_SCHEMA_VERSION},'${DESIGN_SYSTEM_GENERATOR_VERSION}',${quote(snapshot.source)},${quote(snapshot.overrides)},${quote(snapshot)},${quote(snapshot.validation)},${quote(input.legacyProjection)},'${hash}','candidate',NULL,${input.baseRevisionId});`,
		`UPDATE design_system_state`,
		` SET active_revision_id=(SELECT id FROM design_system_revisions WHERE content_hash='${hash}' ORDER BY id DESC LIMIT 1),updated_at=datetime('now')`,
		` WHERE id=1 AND active_revision_id=${input.baseRevisionId};`,
		`UPDATE design_system_revisions`,
		` SET status='published',published_at=datetime('now')`,
		` WHERE content_hash='${hash}' AND status='candidate'`,
		` AND EXISTS (SELECT 1 FROM design_system_state WHERE id=1 AND active_revision_id=design_system_revisions.id);`,
	].join("\n");
	writeFileSync(resolve(outputPath), sql, "utf8");
	console.log(`Recovery SQL generated for ${hash}.`);
}

void main();
