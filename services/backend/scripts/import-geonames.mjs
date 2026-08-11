#!/usr/bin/env node
/**
 * Build an idempotent D1 SQL import from GeoNames cities500 + alternateNamesV2.
 *
 * Usage:
 *   node scripts/import-geonames.mjs --cities C:\data\cities500.txt \
 *     --alternates C:\data\alternateNamesV2.txt --out generated\geonames.sql
 *   npx wrangler d1 execute orderak-db --remote --file=generated/geonames.sql
 *
 * Source/license: https://www.geonames.org/ — CC BY 4.0.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	args.set(process.argv[index], process.argv[index + 1]);
}
const citiesPath = args.get("--cities");
const alternatesPath = args.get("--alternates");
const outputPath = args.get("--out");
if (!citiesPath || !alternatesPath || !outputPath) {
	console.error("Required: --cities <cities500.txt> --alternates <alternateNamesV2.txt> --out <file.sql>");
	process.exitCode = 2;
} else {
	await buildImport(resolve(citiesPath), resolve(alternatesPath), resolve(outputPath));
}

async function buildImport(citiesFile, alternatesFile, outputFile) {
	const cities = new Map();
	for await (const line of lines(citiesFile)) {
		const row = line.split("\t");
		if (row.length < 18) continue;
		const geonameId = integer(row[0]);
		const countryIso = row[8]?.toUpperCase();
		if (!geonameId || !/^[A-Z]{2}$/.test(countryIso)) continue;
		cities.set(geonameId, {
			geonameId,
			name: row[1],
			asciiName: row[2],
			countryIso,
			admin1Code: row[10] || null,
			population: integer(row[14]) ?? 0,
			timezone: row[17] || null,
			names: new Map(),
		});
	}

	for await (const line of lines(alternatesFile)) {
		const row = line.split("\t");
		if (row.length < 8) continue;
		const geonameId = integer(row[1]);
		const lang = row[2];
		const name = row[3]?.trim();
		const city = cities.get(geonameId);
		if (!city || !name || !["ar", "en", "fr"].includes(lang)) continue;
		const preferred = row[4] === "1";
		const existing = city.names.get(lang);
		if (!existing || preferred) city.names.set(lang, { name, preferred });
	}

	await mkdir(dirname(outputFile), { recursive: true });
	const output = createWriteStream(outputFile, { encoding: "utf8" });
	await writeSql(output, "-- Generated from GeoNames cities500 + alternateNamesV2 (CC BY 4.0).\n");
	// D1 imports already manage their own transaction boundary. Explicit
	// BEGIN/COMMIT causes `wrangler d1 execute --file` to reject the import.
	await writeSql(output, "DELETE FROM geo_city_search;\nDELETE FROM geo_city_names;\nDELETE FROM geo_cities;\n");
	for (const city of cities.values()) {
		await writeSql(output,
			`INSERT INTO geo_cities(geoname_id,country_iso,name,ascii_name,admin1_code,population,timezone) VALUES(` +
			`${city.geonameId},${sql(city.countryIso)},${sql(city.name)},${sql(city.asciiName)},` +
			`${sql(city.admin1Code)},${city.population},${sql(city.timezone)});\n`,
		);
		// Always index the canonical/ascii city name as language-neutral so a
		// missing ar/en/fr preferred name never makes a city undiscoverable.
		await writeSql(output,
			`INSERT INTO geo_city_names(geoname_id,lang,name,preferred) VALUES(` +
			`${city.geonameId},'und',${sql(city.name)},1);\n`,
		);
		await writeSql(output,
			`INSERT INTO geo_city_search(geoname_id,country_iso,lang,name,ascii_name) VALUES(` +
			`${city.geonameId},${sql(city.countryIso)},'und',${sql(city.name)},${sql(city.asciiName)});\n`,
		);
		for (const [lang, translation] of city.names) {
			await writeSql(output,
				`INSERT INTO geo_city_names(geoname_id,lang,name,preferred) VALUES(` +
				`${city.geonameId},${sql(lang)},${sql(translation.name)},${translation.preferred ? 1 : 0});\n`,
			);
			await writeSql(output,
				`INSERT INTO geo_city_search(geoname_id,country_iso,lang,name,ascii_name) VALUES(` +
				`${city.geonameId},${sql(city.countryIso)},${sql(lang)},${sql(translation.name)},${sql(city.asciiName)});\n`,
			);
		}
	}
	await writeSql(output, "PRAGMA optimize;\n");
	output.end();
	await once(output, "finish");
	console.log(JSON.stringify({ output: outputFile, cities: cities.size }));
}

async function writeSql(stream, value) {
	if (!stream.write(value)) await once(stream, "drain");
}

async function* lines(path) {
	const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
	for await (const line of reader) yield line;
}

function integer(value) {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sql(value) {
	return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}
