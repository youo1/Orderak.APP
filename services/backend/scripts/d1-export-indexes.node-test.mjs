// The .node-test suffix keeps Vitest from collecting this node:test suite.
import assert from "node:assert/strict";
import test from "node:test";
import { computeIndexStatements, parseWranglerJson } from "./d1-export-indexes.mjs";

test("emits a CREATE INDEX statement for an ordinary index", () => {
	const results = [
		{ type: "table", name: "sellers", tbl_name: "sellers", sql: "CREATE TABLE sellers (id INTEGER PRIMARY KEY, phone TEXT)" },
		{ type: "index", name: "idx_sellers_phone", tbl_name: "sellers", sql: "CREATE INDEX idx_sellers_phone ON sellers(phone)" },
	];
	const { statements, emitted, skippedAuto, skippedFts5 } = computeIndexStatements(results);
	assert.equal(emitted, 1);
	assert.equal(skippedAuto, 0);
	assert.equal(skippedFts5, 0);
	assert.deepEqual(statements, ["CREATE INDEX idx_sellers_phone ON sellers(phone);"]);
});

test("excludes sqlite's own autoindexes for UNIQUE/PRIMARY KEY constraints", () => {
	const results = [
		{ type: "table", name: "orders", tbl_name: "orders", sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT UNIQUE)" },
		{ type: "index", name: "sqlite_autoindex_orders_1", tbl_name: "orders", sql: null },
	];
	const { statements, emitted, skippedAuto } = computeIndexStatements(results);
	assert.equal(emitted, 0);
	assert.equal(skippedAuto, 1);
	assert.deepEqual(statements, []);
});

test("excludes indexes on FTS5 virtual tables", () => {
	const results = [
		{ type: "table", name: "geo_city_search", tbl_name: "geo_city_search", sql: "CREATE VIRTUAL TABLE geo_city_search USING fts5(name)" },
		{ type: "table", name: "geo_city_search_data", tbl_name: "geo_city_search_data", sql: "CREATE TABLE geo_city_search_data (id INTEGER PRIMARY KEY, block BLOB)" },
		{ type: "index", name: "idx_shadow", tbl_name: "geo_city_search_data", sql: "CREATE INDEX idx_shadow ON geo_city_search_data(id)" },
	];
	const { statements, emitted, skippedFts5 } = computeIndexStatements(results);
	assert.equal(emitted, 0);
	assert.equal(skippedFts5, 1);
	assert.deepEqual(statements, []);
});

test("keeps indexes on ordinary tables that merely sit next to an FTS5 table", () => {
	const results = [
		{ type: "table", name: "geo_city_search", tbl_name: "geo_city_search", sql: "CREATE VIRTUAL TABLE geo_city_search USING fts5(name)" },
		{ type: "table", name: "geo_cities", tbl_name: "geo_cities", sql: "CREATE TABLE geo_cities (id INTEGER PRIMARY KEY, country TEXT)" },
		{ type: "index", name: "idx_geo_cities_country", tbl_name: "geo_cities", sql: "CREATE INDEX idx_geo_cities_country ON geo_cities(country)" },
	];
	const { statements, emitted, skippedFts5 } = computeIndexStatements(results);
	assert.equal(emitted, 1);
	assert.equal(skippedFts5, 0);
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
