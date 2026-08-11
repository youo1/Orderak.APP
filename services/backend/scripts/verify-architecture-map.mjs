import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../../..");
const mapPath = path.join(root, "docs/architecture/orderak-full-architecture.html");
const source = fs.readFileSync(mapPath, "utf8");
const failures = [];

const nodePattern = /&lt;g id=&quot;(node-[^&]+)&quot; class=&quot;arch-node[^&]*&quot; data-domain=&quot;([^&]+)&quot;&gt;/g;
const edgePattern = /&lt;g id=&quot;(edge-[^&]+)&quot; class=&quot;arch-edge&quot; data-from=&quot;([^&]+)&quot; data-to=&quot;([^&]+)&quot; data-domain=&quot;([^&]+)&quot;&gt;/g;
const nodes = new Map([...source.matchAll(nodePattern)].map((match) => [match[1], new Set(match[2].split(/\s+/))]));
const edges = [...source.matchAll(edgePattern)].map((match) => ({
	id: match[1], from: match[2], to: match[3], domains: match[4].split(/\s+/),
}));

const allNodeTags = [...source.matchAll(/&lt;g(?: id=&quot;[^&]+&quot;)? class=&quot;arch-node/g)].length;
const allEdgeTags = [...source.matchAll(/&lt;g(?: id=&quot;[^&]+&quot;)? class=&quot;arch-edge&quot;/g)].length;
if (nodes.size !== allNodeTags) failures.push(`${allNodeTags - nodes.size} architecture nodes lack a stable ID/domain`);
if (edges.length !== allEdgeTags) failures.push(`${allEdgeTags - edges.length} architecture edges lack stable ID/data-from/data-to/domain metadata`);

for (const edge of edges) {
	const from = nodes.get(edge.from);
	const to = nodes.get(edge.to);
	if (!from) failures.push(`${edge.id} references missing source ${edge.from}`);
	if (!to) failures.push(`${edge.id} references missing target ${edge.to}`);
	for (const domain of edge.domains) {
		if (from && !from.has(domain)) failures.push(`${edge.id} domain ${domain} is inactive on ${edge.from}`);
		if (to && !to.has(domain)) failures.push(`${edge.id} domain ${domain} is inactive on ${edge.to}`);
	}
}

for (const required of [
	"Queue: batch 5 · 5 s · concurrency 10",
	"After 8 exhausted retries",
	"At-least-once · 120 s atomic claim lease",
	"active duplicate = ack/no-op",
]) {
	if (!source.includes(required)) failures.push(`outdated or missing queue label: ${required}`);
}
if (!source.includes("arch-edge.is-hidden") || !source.includes("data-from")) {
	failures.push("focused views must hide irrelevant edges using explicit endpoints");
}

if (failures.length) {
	console.error(failures.map((failure) => `- ${failure}`).join("\n"));
	process.exit(1);
}
console.log(`Architecture map valid: ${nodes.size} nodes, ${edges.length} edges.`);
