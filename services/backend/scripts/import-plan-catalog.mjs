import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const [sourceArg, catalogArg, seedArg] = process.argv.slice(2);
const sourcePath = path.resolve(sourceArg ?? "docs/product/orderak-plan-catalog.json");
const catalogPath = path.resolve(catalogArg ?? "docs/product/orderak-plan-catalog.json");
const seedPath = path.resolve(seedArg ?? "services/backend/migrations/025_entitlement_catalog_seed.sql");

const source = await fs.readFile(sourcePath, "utf8");
const existingCatalog = sourcePath.toLowerCase().endsWith(".json") ? JSON.parse(source) : null;

function arrayAfter(marker) {
	const markerAt = source.indexOf(marker);
	const start = source.indexOf("[", markerAt);
	if (markerAt < 0 || start < 0) throw new Error(`Missing ${marker}`);
	let depth = 0;
	let quote = null;
	let escaped = false;
	for (let i = start; i < source.length; i += 1) {
		const char = source[i];
		if (quote) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[") depth += 1;
		else if (char === "]") {
			depth -= 1;
			if (depth === 0) return Function(`"use strict"; return ${source.slice(start, i + 1)}`)();
		}
	}
	throw new Error(`Unterminated ${marker}`);
}

const summaryRows = existingCatalog ? [] : arrayAfter("const summaryRows =");
const groups = existingCatalog ? [] : arrayAfter("const groups =");

const keyOverrides = {
	"Plan limits|Products": "max_products",
	"Plan limits|Categories": "max_categories",
	"Plan limits|Orders per month": "max_orders_per_month",
	"Plan limits|AI requests per month": "max_ai_requests_per_month",
	"Plan limits|Stores / brands": "max_stores",
	"Plan limits|Team members": "max_team_members",
	"Plan limits|Concurrent device access": "max_concurrent_devices",
	"Plan limits|Warehouses / locations": "max_warehouses",
	"Plan limits|Advertising": "show_ads",
	"Plan limits|Essential data retention": "essential_data_retention",
};

const implementedLimits = new Set([
	"max_products",
	"max_categories",
	"max_orders_per_month",
	"max_ai_requests_per_month",
	"max_concurrent_devices",
	"show_ads",
]);

const coreNames = new Set([
	"Product creation and editing",
	"Product descriptions",
	"Public Orderak catalog",
	"Manual order creation",
	"Public catalog orders",
	"Order history",
	"Order status updates",
	"Paid / unpaid tracking",
	"Owner account",
	"Standard Orderak backend",
	"Arabic seller interface",
	"English seller interface",
	"French seller interface",
	"Arabic public storefront",
	"English public storefront",
	"Multiple owner devices",
]);

const slug = (value) => value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
let sortOrder = 0;
const features = [];
for (const [category, rows] of groups) {
	for (const [name, free, paid1, paid2, paid3] of rows) {
		const key = keyOverrides[`${category}|${name}`] ?? `${slug(category)}.${slug(name)}`;
		const sourceValues = { free: String(free), paid1: String(paid1), paid2: String(paid2), paid3: String(paid3) };
		let valueType = "text";
		let unit = null;
		let resetPeriod = "none";
		let supportsUnlimited = false;
		let higherIsBetter = false;
		if (key.startsWith("max_")) {
			valueType = "integer";
			unit = key.includes("orders") ? "orders" : key.includes("ai_") ? "requests" : key.includes("products") ? "products" : key.includes("categories") ? "categories" : key.includes("stores") ? "stores" : key.includes("team") ? "members" : key.includes("devices") ? "devices" : "locations";
			supportsUnlimited = true;
			higherIsBetter = true;
		} else if (key === "show_ads") valueType = "boolean";
		else if (Object.values(sourceValues).every((value) => value === "Included" || value === "—")) valueType = "boolean";
		if (key.endsWith("_per_month")) resetPeriod = "calendar_month_utc";

		let implementationStatus = "planned";
		let enforcementBinding = null;
		let adminConfigurable = false;
		let coreUniversal = false;
		if (implementedLimits.has(key)) {
			implementationStatus = "implemented";
			enforcementBinding = key;
			adminConfigurable = true;
		} else if (coreNames.has(name) || key === "essential_data_retention") {
			implementationStatus = "implemented";
			enforcementBinding = name === "Multiple owner devices" ? "max_concurrent_devices" : "core_universal";
			coreUniversal = name !== "Multiple owner devices";
		}

		features.push({
			key,
			category,
			name,
			description: `Plan comparison source row: ${name}`,
			value_type: valueType,
			unit,
			reset_period: resetPeriod,
			supports_unlimited: supportsUnlimited,
			higher_is_better: higherIsBetter,
			implementation_status: implementationStatus,
			enforcement_binding: enforcementBinding,
			admin_configurable: adminConfigurable,
			core_universal: coreUniversal,
			sort_order: ++sortOrder,
			source_values: sourceValues,
		});
	}
}

const importedFeatures = existingCatalog?.features ?? features;
if (importedFeatures.length !== 242) throw new Error(`Expected 242 features, received ${importedFeatures.length}`);
if (new Set(importedFeatures.map((feature) => feature.key)).size !== importedFeatures.length) throw new Error("Duplicate entitlement key");

const catalog = existingCatalog ?? {
	schema_version: 1,
	source: "Orderak Plan Summary and Feature Comparison workbook",
	generated_at: "2026-07-19",
	plans: [
		{ key: "free", name: "Free", target_customer: "New or occasional seller", primary_value: "Essential selling tools" },
		{ key: "paid1", name: "Paid 1", target_customer: "Individual seller", primary_value: "Remove everyday limits" },
		{ key: "paid2", name: "Paid 2", target_customer: "Power seller or growing team", primary_value: "Growth, automation and teamwork" },
		{ key: "paid3", name: "Paid 3", target_customer: "Organization or multi-location business", primary_value: "Scale, governance and custom service" },
	],
	summary: Object.fromEntries(summaryRows.map((row) => [row[0], { free: String(row[1]), paid1: String(row[2]), paid2: String(row[3]), paid3: String(row[4]) }])),
	features,
};

const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;
const catalogHash = createHash("sha256").update(catalogJson).digest("hex");

const revisionIds = {
	free: "02b0f3d1-62ec-4f1f-baa8-164e905312eb",
	paid1: "c65852f6-ae3a-430b-aec5-81bd7b5fd76d",
	paid2: "ae9d2f87-ac08-4986-b823-10d647b360f6",
	paid3: "e8e42795-e48a-4e6b-86a6-57848cd75bfe",
};

const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const bool = (value) => value ? 1 : 0;
const numericOverrides = {
	max_products: { free: 20, paid1: 200, paid2: 2000, paid3: "unlimited" },
	max_categories: { free: 5, paid1: 20, paid2: 100, paid3: "unlimited" },
	max_orders_per_month: { free: 50, paid1: 500, paid2: 5000, paid3: "unlimited" },
	max_ai_requests_per_month: { free: 20, paid1: 200, paid2: 1000, paid3: "custom_required" },
	max_stores: { free: 1, paid1: 1, paid2: 1, paid3: "custom_required" },
	max_team_members: { free: 1, paid1: 1, paid2: 5, paid3: "custom_required" },
	max_concurrent_devices: { free: 1, paid1: 2, paid2: 10, paid3: "custom_required" },
	max_warehouses: { free: 1, paid1: 1, paid2: 5, paid3: "custom_required" },
};

function entitlementValue(feature, planKey) {
	const raw = feature.source_values[planKey];
	if (feature.key in numericOverrides) {
		const value = numericOverrides[feature.key][planKey];
		if (value === "unlimited" || value === "custom_required") return { mode: value, int: null, bool: null, text: null, display: raw };
		return { mode: "value", int: value, bool: null, text: null, display: raw };
	}
	if (feature.key === "show_ads") return { mode: "value", int: null, bool: planKey === "free" ? 1 : 0, text: null, display: raw };
	if (feature.value_type === "boolean") {
		const enabled = raw === "Included";
		return { mode: enabled ? "value" : "disabled", int: null, bool: enabled ? 1 : 0, text: null, display: raw };
	}
	if (raw === "—") return { mode: "disabled", int: null, bool: null, text: null, display: raw };
	return { mode: "value", int: null, bool: null, text: raw, display: raw };
}

const seed = [];
seed.push("-- Generated from docs/product/orderak-plan-catalog.json by scripts/import-plan-catalog.mjs.");
seed.push("-- Do not hand-edit catalog rows; update the source catalog and regenerate.");
for (const feature of catalog.features) {
	seed.push(`INSERT INTO entitlement_definitions (entitlement_key,category,name,description,value_type,unit,reset_period,supports_unlimited,higher_is_better,implementation_status,enforcement_binding,admin_configurable,core_universal,sort_order,active) VALUES (${sql(feature.key)},${sql(feature.category)},${sql(feature.name)},${sql(feature.description)},${sql(feature.value_type)},${sql(feature.unit)},${sql(feature.reset_period)},${bool(feature.supports_unlimited)},${bool(feature.higher_is_better)},${sql(feature.implementation_status)},${sql(feature.enforcement_binding)},${bool(feature.admin_configurable)},${bool(feature.core_universal)},${feature.sort_order},1);`);
	for (const planKey of ["free", "paid1", "paid2", "paid3"]) {
		const value = entitlementValue(feature, planKey);
		seed.push(`INSERT INTO plan_revision_entitlements (revision_id,entitlement_key,value_mode,bool_value,int_value,text_value,display_value) VALUES (${sql(revisionIds[planKey])},${sql(feature.key)},${sql(value.mode)},${value.bool ?? "NULL"},${value.int ?? "NULL"},${sql(value.text)},${sql(value.display)});`);
	}
}
seed.push(`UPDATE plan_revisions SET source_catalog_hash=${sql(catalogHash)} WHERE id IN (${Object.values(revisionIds).map(sql).join(",")});`);

await fs.mkdir(path.dirname(catalogPath), { recursive: true });
await fs.mkdir(path.dirname(seedPath), { recursive: true });
await fs.writeFile(catalogPath, catalogJson, "utf8");
await fs.writeFile(seedPath, `${seed.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ features: catalog.features.length, catalogHash, catalogPath, seedPath }));
