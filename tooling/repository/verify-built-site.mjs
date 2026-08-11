#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const siteRoot = resolve(process.argv[2] ?? "site");
if (!existsSync(siteRoot) || !statSync(siteRoot).isDirectory()) {
	throw new Error(`Built site directory does not exist: ${siteRoot}`);
}

const files = [];
const visit = (directory) => {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) visit(path);
		else if (entry.isFile()) files.push(path);
	}
};
visit(siteRoot);

const archiveOutputs = files.filter((file) =>
	relative(siteRoot, file)
		.split(sep)
		.some((part) => part.toLowerCase() === "archive"),
);
if (archiveOutputs.length > 0) {
	throw new Error(`Unpublished archive files were built:\n${archiveOutputs.map((file) => `  ${relative(siteRoot, file)}`).join("\n")}`);
}

const searchableExtensions = new Set([".html", ".json", ".xml"]);
const archiveReferences = [];
for (const file of files) {
	const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
	if (!searchableExtensions.has(extension)) continue;
	if (/archive\//i.test(readFileSync(file, "utf8"))) {
		archiveReferences.push(relative(siteRoot, file));
	}
}
if (archiveReferences.length > 0) {
	throw new Error(`Built site still references an archive/ URL:\n${archiveReferences.map((file) => `  ${file}`).join("\n")}`);
}

console.log(`Built-site publication guard passed: ${files.length} files contain no archive output or URL.`);
