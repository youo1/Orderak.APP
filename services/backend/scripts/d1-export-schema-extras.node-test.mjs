// The .node-test suffix keeps Vitest from collecting this node:test suite.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { computeSchemaExtras, parseRebuildBlocks, parseWranglerJson } from "./d1-export-schema-extras.mjs";

const REBUILD_SQL = readFileSync(new URL("./d1-search-index-rebuild.sql", import.meta.url), "utf8");
const REBUILDS = parseRebuildBlocks(REBUILD_SQL);

const VTAB = (name, columns) => ({
	type: "table",
	name,
	tbl_name: name,
	sql: `CREATE VIRTUAL TABLE ${name} USING fts5(${columns}, tokenize='unicode61 remove_diacritics 2')`,
});

test("emits a CREATE INDEX statement for an ordinary index", () => {
	const results = [
		{ type: "table", name: "sellers", tbl_name: "sellers", sql: "CREATE TABLE sellers (id INTEGER PRIMARY KEY, phone TEXT)" },
		{ type: "index", name: "idx_sellers_phone", tbl_name: "sellers", sql: "CREATE INDEX idx_sellers_phone ON sellers(phone)" },
	];
	const { statements, counts } = computeSchemaExtras(results);
	assert.equal(counts.indexes, 1);
	assert.equal(counts.triggers, 0);
	assert.deepEqual(statements, ["CREATE INDEX idx_sellers_phone ON sellers(phone);"]);
});

test("emits a CREATE TRIGGER statement for an ordinary trigger", () => {
	const results = [
		{ type: "table", name: "order_items", tbl_name: "order_items", sql: "CREATE TABLE order_items (id INTEGER PRIMARY KEY, qty INTEGER)" },
		{
			type: "trigger",
			name: "trg_order_items_claim_stock",
			tbl_name: "order_items",
			sql: "CREATE TRIGGER trg_order_items_claim_stock AFTER INSERT ON order_items BEGIN SELECT 1; END",
		},
	];
	const { statements, counts } = computeSchemaExtras(results);
	assert.equal(counts.triggers, 1);
	assert.equal(counts.indexes, 0);
	assert.deepEqual(statements, [
		"CREATE TRIGGER trg_order_items_claim_stock AFTER INSERT ON order_items BEGIN SELECT 1; END;",
	]);
});

test("excludes sqlite's own autoindexes for UNIQUE/PRIMARY KEY constraints", () => {
	const results = [
		{ type: "table", name: "orders", tbl_name: "orders", sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT UNIQUE)" },
		{ type: "index", name: "sqlite_autoindex_orders_1", tbl_name: "orders", sql: null },
	];
	const { statements, counts } = computeSchemaExtras(results);
	assert.equal(counts.indexes, 0);
	assert.equal(counts.skippedAuto, 1);
	assert.deepEqual(statements, []);
});

test("excludes indexes and triggers on FTS5 virtual tables", () => {
	const results = [
		{ type: "table", name: "geo_city_search", tbl_name: "geo_city_search", sql: "CREATE VIRTUAL TABLE geo_city_search USING fts5(name)" },
		{ type: "table", name: "geo_city_search_data", tbl_name: "geo_city_search_data", sql: "CREATE TABLE geo_city_search_data (id INTEGER PRIMARY KEY, block BLOB)" },
		{ type: "index", name: "idx_shadow", tbl_name: "geo_city_search_data", sql: "CREATE INDEX idx_shadow ON geo_city_search_data(id)" },
		{
			type: "trigger",
			name: "trg_shadow_sync",
			tbl_name: "geo_city_search_data",
			sql: "CREATE TRIGGER trg_shadow_sync AFTER INSERT ON geo_city_search_data BEGIN SELECT 1; END",
		},
	];
	const { statements, counts } = computeSchemaExtras(results);
	assert.equal(counts.indexes, 0);
	assert.equal(counts.triggers, 0);
	assert.equal(counts.skippedFts5, 2);
	assert.deepEqual(statements, []);
});

test("keeps indexes and triggers on ordinary tables that merely sit next to an FTS5 table", () => {
	const results = [
		{ type: "table", name: "geo_city_search", tbl_name: "geo_city_search", sql: "CREATE VIRTUAL TABLE geo_city_search USING fts5(name)" },
		{ type: "table", name: "geo_cities", tbl_name: "geo_cities", sql: "CREATE TABLE geo_cities (id INTEGER PRIMARY KEY, country TEXT)" },
		{ type: "index", name: "idx_geo_cities_country", tbl_name: "geo_cities", sql: "CREATE INDEX idx_geo_cities_country ON geo_cities(country)" },
	];
	const { statements, counts } = computeSchemaExtras(results);
	assert.equal(counts.indexes, 1);
	assert.equal(counts.skippedFts5, 0);
	assert.deepEqual(statements, ["CREATE INDEX idx_geo_cities_country ON geo_cities(country);"]);
});

test("parseWranglerJson tolerates a leading banner line", () => {
	const withBanner = " ⛅️ wrangler 4.119.0\n[{\"results\":[]}]";
	const parsed = parseWranglerJson(withBanner);
	assert.deepEqual(parsed, [{ results: [] }]);
});

test("parseWranglerJson returns null for unparseable input", () => {
	assert.equal(parseWranglerJson("not json at all"), null);
});

// --- FTS5 search tables ------------------------------------------------------
//
// These three tables were in no backup and had no rebuild path: excluded from
// the export by d1-exportable-tables.mjs, recreated by nothing, and invisible
// to the restore drill because the export and the restore were equally
// incomplete. A restore produced a database where every search query failed
// with "no such table".

test("every FTS5 search table in the schema has a rebuild block", () => {
	assert.deepEqual(
		[...REBUILDS.keys()].sort(),
		["business_taxonomy_search", "city_catalog_search", "geo_city_search"],
	);
});

test("emits the CREATE VIRTUAL TABLE statement followed by its rebuild", () => {
	const results = [VTAB("geo_city_search", "geoname_id UNINDEXED, name")];
	const { statements, counts, missingRebuilds } = computeSchemaExtras(results, REBUILDS);
	assert.equal(counts.virtualTables, 1);
	assert.deepEqual(missingRebuilds, []);
	assert.match(statements[0], /^CREATE VIRTUAL TABLE geo_city_search USING fts5\(/);
	assert.match(statements[1], /INSERT INTO geo_city_search/);
});

test("reports a virtual table that has no rebuild block instead of emitting it", () => {
	const { statements, counts, missingRebuilds } = computeSchemaExtras(
		[VTAB("orders_search", "note")],
		REBUILDS,
	);
	assert.deepEqual(missingRebuilds, ["orders_search"]);
	assert.equal(counts.virtualTables, 0);
	assert.deepEqual(statements, []);
});

test("a restore of the appended statements repopulates every search index", () => {
	// The durable tables the export does contain, populated as the importers
	// populate them, and nothing else — no shadow tables, no search rows.
	const db = new DatabaseSync(":memory:");
	db.exec(`
		CREATE TABLE geo_cities (geoname_id INTEGER PRIMARY KEY, country_iso TEXT, name TEXT, ascii_name TEXT);
		CREATE TABLE geo_city_names (geoname_id INTEGER, lang TEXT, name TEXT, preferred INTEGER);
		CREATE TABLE business_taxonomy_versions (id INTEGER PRIMARY KEY, status TEXT);
		CREATE TABLE business_subcategories (id TEXT PRIMARY KEY, version_id INTEGER, category_id TEXT, name_en TEXT, name_ar TEXT, name_fr TEXT, active INTEGER);
		CREATE TABLE city_catalog (version TEXT, source_city_id INTEGER, country_iso TEXT, name TEXT, native_name TEXT, state_code TEXT, state_name TEXT);
		INSERT INTO geo_cities VALUES (360630, 'EG', 'Cairo', 'Cairo');
		INSERT INTO geo_city_names VALUES (360630, 'und', 'Cairo', 1), (360630, 'ar', 'القاهرة', 1);
		INSERT INTO business_taxonomy_versions VALUES (1, 'active'), (2, 'draft');
		INSERT INTO business_subcategories VALUES ('retail_shop', 1, 'retail', 'Shop', 'متجر', 'Boutique', 1);
		INSERT INTO business_subcategories VALUES ('draft_thing', 2, 'retail', 'Draft', 'مسودة', 'Brouillon', 1);
		INSERT INTO city_catalog VALUES ('v1', 123, 'EG', 'Giza', 'الجيزة', 'GZ', 'Giza');
	`);

	const results = [
		VTAB("geo_city_search", "geoname_id UNINDEXED, country_iso UNINDEXED, lang UNINDEXED, name, ascii_name"),
		VTAB("business_taxonomy_search", "subcategory_id UNINDEXED, category_id UNINDEXED, name_en, name_ar, name_fr"),
		VTAB("city_catalog_search", "version UNINDEXED, source_city_id UNINDEXED, country_iso UNINDEXED, name, native_name, state_name"),
	];
	const { statements, missingRebuilds } = computeSchemaExtras(results, REBUILDS);
	assert.deepEqual(missingRebuilds, []);
	db.exec(statements.join("\n"));

	const matches = (table, term) =>
		db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table} MATCH ?`).get(term).n;
	assert.equal(matches("geo_city_search", "Cairo"), 2, "both the 'und' and 'ar' rows carry the ascii name");
	assert.equal(matches("geo_city_search", "القاهرة"), 1, "the Arabic name is searchable after a restore");
	assert.equal(matches("city_catalog_search", "Giza"), 1);
	assert.equal(matches("business_taxonomy_search", "Shop"), 1);
	// Only the active taxonomy version is indexed, as migration 037 indexed it.
	assert.equal(matches("business_taxonomy_search", "Draft"), 0);
});

test("indexes and triggers owned by FTS5 shadow tables stay excluded", () => {
	// The CREATE VIRTUAL TABLE statement recreates FTS5's internal objects, so
	// emitting them separately would collide with it.
	const results = [
		VTAB("geo_city_search", "name"),
		{ type: "table", name: "geo_city_search_data", tbl_name: "geo_city_search_data", sql: "CREATE TABLE geo_city_search_data(id INTEGER PRIMARY KEY, block BLOB)" },
		{ type: "index", name: "idx_shadow", tbl_name: "geo_city_search_data", sql: "CREATE INDEX idx_shadow ON geo_city_search_data(id)" },
	];
	const { counts } = computeSchemaExtras(results, REBUILDS);
	assert.equal(counts.skippedFts5, 1);
	assert.equal(counts.indexes, 0);
});
