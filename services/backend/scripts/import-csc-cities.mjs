import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable, Transform } from "node:stream";

const DATASET_VERSION = "v3.2-export.6";
const SOURCE_URL =
  "https://github.com/dr5hn/countries-states-cities-database/releases/download/" +
  `${DATASET_VERSION}/csv-cities.csv.gz`;
const SOURCE_SHA256 = "9f4a0c88590ba38a883cfc63e233eb63fd443041dfd790fcb485a6ddd5864dbc";
const LICENSE = "ODbL-1.0";
const DEFAULT_OUTPUT = resolve("generated", `cities-${DATASET_VERSION}.sql`);
const CHUNK_SIZE = 250;

const args = parseArgs(process.argv.slice(2));
const outputPath = resolve(args.output ?? DEFAULT_OUTPUT);
const downloadedPath = resolve("generated", basename(SOURCE_URL));
const inputPath = args.input ? resolve(args.input) : downloadedPath;

await mkdir(dirname(outputPath), { recursive: true });

if (!args.input) {
  const existing = await fileExists(inputPath);
  if (!existing || await sha256File(inputPath) !== SOURCE_SHA256) {
    await download(SOURCE_URL, inputPath);
  }
}

const actualHash = await sha256File(inputPath);
if (actualHash !== SOURCE_SHA256) {
  throw new Error(
    `Dataset checksum mismatch. Expected ${SOURCE_SHA256}, received ${actualHash}.`,
  );
}

const csvPath = `${inputPath}.csv`;
await pipeline(createReadStream(inputPath), createGunzip(), createWriteStream(csvPath));

const sql = createWriteStream(outputPath, { encoding: "utf8" });
sql.write("-- Generated file. Do not edit.\n");
sql.write(`-- Dataset: ${DATASET_VERSION}\n`);
sql.write(`-- Source: ${SOURCE_URL}\n`);
sql.write(`-- SHA-256: ${SOURCE_SHA256}\n`);
sql.write("PRAGMA foreign_keys = ON;\n");
sql.write(
  "INSERT OR REPLACE INTO city_catalog_versions" +
  "(version,source_url,source_sha256,license,city_count,active,imported_at) VALUES(" +
  `${quote(DATASET_VERSION)},${quote(SOURCE_URL)},${quote(SOURCE_SHA256)},` +
  `${quote(LICENSE)},0,0,datetime('now'));\n`,
);
sql.write(`DELETE FROM city_catalog_search WHERE version=${quote(DATASET_VERSION)};\n`);
sql.write(`DELETE FROM city_catalog WHERE version=${quote(DATASET_VERSION)};\n`);

let header;
let rowCount = 0;
let cityValues = [];
let searchValues = [];

for await (const row of csvRows(createReadStream(csvPath))) {
  if (!header) {
    header = row;
    validateHeader(header);
    continue;
  }
  if (row.length === 1 && row[0] === "") continue;
  const record = Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""]));
  const sourceId = integer(record.id);
  const countryIso = record.country_code.trim().toUpperCase();
  const name = record.name.trim();
  if (!sourceId || !/^[A-Z]{2}$/.test(countryIso) || !name) continue;

  const nativeName = nullable(record.native);
  const stateCode = nullable(record.state_code);
  const stateName = nullable(record.state_name);
  const population = Math.max(0, integer(record.population) ?? 0);
  const timezone = nullable(record.timezone);
  cityValues.push(
    `(${quote(DATASET_VERSION)},${sourceId},${quote(countryIso)},${quote(name)},` +
    `${quote(nativeName)},${quote(stateCode)},${quote(stateName)},${population},${quote(timezone)})`,
  );
  searchValues.push(
    `(${quote(DATASET_VERSION)},${sourceId},${quote(countryIso)},${quote(name)},` +
    `${quote(nativeName)},${quote(stateName)})`,
  );
  rowCount += 1;
  if (cityValues.length >= CHUNK_SIZE) flushRows();
}
flushRows();

sql.write(
  `UPDATE city_catalog_versions SET city_count=${rowCount},imported_at=datetime('now') ` +
  `WHERE version=${quote(DATASET_VERSION)};\n`,
);
sql.write("UPDATE city_catalog_versions SET active=0 WHERE active=1;\n");
sql.write(
  `UPDATE city_catalog_versions SET active=1 WHERE version=${quote(DATASET_VERSION)};\n`,
);
sql.end();
await new Promise((resolvePromise, reject) => {
  sql.on("finish", resolvePromise);
  sql.on("error", reject);
});
await rm(csvPath, { force: true });
console.log(JSON.stringify({
  version: DATASET_VERSION,
  rows: rowCount,
  output: outputPath,
  source_sha256: SOURCE_SHA256,
}));

function flushRows() {
  if (cityValues.length) {
    sql.write(
      "INSERT INTO city_catalog" +
      "(version,source_city_id,country_iso,name,native_name,state_code,state_name,population,timezone) VALUES\n" +
      `${cityValues.join(",\n")};\n`,
    );
  }
  if (searchValues.length) {
    sql.write(
      "INSERT INTO city_catalog_search" +
      "(version,source_city_id,country_iso,name,native_name,state_name) VALUES\n" +
      `${searchValues.join(",\n")};\n`,
    );
  }
  cityValues = [];
  searchValues = [];
}

function validateHeader(columns) {
  const required = [
    "id", "name", "state_code", "state_name", "country_code",
    "native", "population", "timezone",
  ];
  const missing = required.filter((column) => !columns.includes(column));
  if (missing.length) throw new Error(`Dataset is missing columns: ${missing.join(", ")}`);
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Dataset download failed with HTTP ${response.status}.`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest("hex");
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--input") result.input = values[++index];
    else if (values[index] === "--output") result.output = values[++index];
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  return result;
}

function integer(value) {
  if (!/^-?\d+$/.test(String(value).trim())) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullable(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function quote(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function* csvRows(stream) {
  let field = "";
  let row = [];
  let quoted = false;
  let pendingQuote = false;
  for await (const chunk of stream.setEncoding("utf8")) {
    for (const character of chunk) {
      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') {
          field += '"';
          continue;
        }
        quoted = false;
      }
      if (quoted) {
        if (character === '"') pendingQuote = true;
        else field += character;
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        yield row;
        field = "";
        row = [];
      } else {
        field += character;
      }
    }
  }
  if (pendingQuote) quoted = false;
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field.");
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}
