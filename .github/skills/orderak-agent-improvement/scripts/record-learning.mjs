import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
const defaultTargetFile = fileURLToPath(
  new URL("../references/learned-guidance.md", import.meta.url),
);

const areaLabels = new Map([
  ["repository", "Repository"],
  ["android", "Android"],
  ["backend", "Backend"],
  ["admin-web", "Admin frontend"],
  ["documentation", "Documentation"],
  ["verification", "Verification"],
]);

const maximumEntriesPerArea = 25;

function fail(message) {
  throw new Error(message);
}

function normalizedGuidance(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function containsSensitiveValue(value) {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\b(?:api[_ -]?key|client[_ -]?secret|password|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/i,
  ].some((pattern) => pattern.test(value));
}

function validateGuidance(guidance) {
  if (typeof guidance !== "string") {
    fail("Guidance is required.");
  }

  const trimmed = guidance.trim();
  if (trimmed.length < 20 || trimmed.length > 400) {
    fail("Guidance must be between 20 and 400 characters.");
  }
  if (/[\r\n`<>]/.test(trimmed)) {
    fail("Guidance must be one plain-text line without Markdown control characters.");
  }
  if (containsSensitiveValue(trimmed)) {
    fail("Guidance appears to contain a secret or credential.");
  }
  if (
    /\b(?:bypass|disable|remove|weaken|skip|ignore)\b.{0,50}\b(?:authentication|authorization|security|contract|guard|validation|approval|tenant|localization|tests?)\b/i.test(
      trimmed,
    ) ||
    /\bauto.?approve\s+(?:all|any|every)\b/i.test(trimmed)
  ) {
    fail("Guidance may not weaken protected behavior or approval boundaries.");
  }

  return trimmed;
}

function parseEvidence(value, repositoryRoot) {
  if (typeof value !== "string" || !value.trim()) {
    fail("At least one repository evidence path is required.");
  }

  const entries = value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (entries.length === 0 || entries.length > 8) {
    fail("Provide between one and eight evidence paths.");
  }

  return entries.map((entry) => {
    if (/[\r\n`<>]/.test(entry) || /^[a-z]+:\/\//i.test(entry)) {
      fail(`Invalid evidence path: ${entry}`);
    }

    const lineMatch = entry.match(/^(.*?)(?::([1-9]\d*))?$/);
    const suppliedPath = lineMatch?.[1]?.replaceAll("\\", "/").replace(/^\.\//, "");
    const line = lineMatch?.[2];

    if (
      !suppliedPath ||
      path.isAbsolute(suppliedPath) ||
      /^[A-Za-z]:/.test(suppliedPath) ||
      suppliedPath.split("/").includes("..")
    ) {
      fail(`Evidence must be a repository-relative path: ${entry}`);
    }
    if (
      /(^|\/)(?:\.git|node_modules|build|dist|coverage|outputs?|logs?)(?:\/|$)/i.test(
        suppliedPath,
      )
    ) {
      fail(`Generated or internal paths cannot be evidence: ${entry}`);
    }

    const absolutePath = path.resolve(repositoryRoot, suppliedPath);
    const relativePath = path.relative(repositoryRoot, absolutePath);
    if (
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      !fs.existsSync(absolutePath) ||
      !fs.statSync(absolutePath).isFile()
    ) {
      fail(`Evidence file does not exist in the repository: ${entry}`);
    }

    if (line) {
      const lineCount = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/).length;
      if (Number(line) > lineCount) {
        fail(`Evidence line is outside the file: ${entry}`);
      }
    }

    return `${suppliedPath}${line ? `:${line}` : ""}`;
  });
}

function sectionContent(content, area) {
  const marker = `<!-- learning:${area} -->`;
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    fail(`Learning reference is missing marker ${marker}.`);
  }
  if (content.indexOf(marker, markerIndex + marker.length) >= 0) {
    fail(`Learning reference contains duplicate marker ${marker}.`);
  }

  const sectionStart = markerIndex + marker.length;
  const nextHeading = content.indexOf("\n## ", sectionStart);
  return content.slice(
    sectionStart,
    nextHeading < 0 ? content.length : nextHeading,
  );
}

export function checkLearningReference({
  targetFile = defaultTargetFile,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  if (!fs.existsSync(targetFile)) {
    fail(`Learning reference does not exist: ${targetFile}`);
  }

  const content = fs.readFileSync(targetFile, "utf8");
  for (const area of areaLabels.keys()) {
    const section = sectionContent(content, area);
    const entries = [
      ...section.matchAll(
        /^- (.+?) Evidence: (`[^`]+`(?:, `[^`]+`)*)\.$/gm,
      ),
    ];
    const nonBlank = section
      .replace(/^- .+ Evidence: `[^`]+`(?:, `[^`]+`)*\.$/gm, "")
      .trim();

    if (entries.length > maximumEntriesPerArea) {
      fail(`${areaLabels.get(area)} exceeds ${maximumEntriesPerArea} entries.`);
    }
    if (nonBlank) {
      fail(`${areaLabels.get(area)} contains content not written by the recorder.`);
    }
    for (const entry of entries) {
      validateGuidance(entry[1]);
      const evidence = [...entry[2].matchAll(/`([^`]+)`/g)].map(
        (match) => match[1],
      );
      parseEvidence(evidence.join(","), repositoryRoot);
    }
  }

  return {
    status: "valid",
    file: targetFile.replaceAll("\\", "/"),
  };
}

export function recordLearning({
  area,
  guidance,
  evidence,
  repositoryRoot = defaultRepositoryRoot,
  targetFile = defaultTargetFile,
}) {
  if (!areaLabels.has(area)) {
    fail(`Area must be one of: ${[...areaLabels.keys()].join(", ")}.`);
  }

  const safeGuidance = validateGuidance(guidance);
  const safeEvidence = parseEvidence(evidence, repositoryRoot);
  const content = fs.readFileSync(targetFile, "utf8");
  const section = sectionContent(content, area);
  const currentEntries =
    section.match(/^- (.+?) Evidence: `[^`]+`(?:, `[^`]+`)*\.$/gm) ?? [];
  const fingerprint = normalizedGuidance(safeGuidance);
  const duplicate = currentEntries.some((entry) => {
    const existingGuidance = entry.match(/^- (.+?) Evidence:/)?.[1] ?? "";
    return normalizedGuidance(existingGuidance) === fingerprint;
  });

  if (duplicate) {
    return {
      status: "duplicate",
      area,
      guidance: safeGuidance,
    };
  }
  if (currentEntries.length >= maximumEntriesPerArea) {
    fail(
      `${areaLabels.get(area)} already has ${maximumEntriesPerArea} entries; consolidate it manually before adding more.`,
    );
  }

  const marker = `<!-- learning:${area} -->`;
  const insertionPoint = content.indexOf(marker) + marker.length;
  const evidenceText = safeEvidence.map((item) => `\`${item}\``).join(", ");
  const entry = `- ${safeGuidance} Evidence: ${evidenceText}.`;
  const updated =
    content.slice(0, insertionPoint) +
    `\n\n${entry}` +
    content.slice(insertionPoint);

  fs.writeFileSync(targetFile, updated, "utf8");
  checkLearningReference({ targetFile, repositoryRoot });

  return {
    status: "added",
    area,
    guidance: safeGuidance,
    evidence: safeEvidence,
    file: path.relative(repositoryRoot, targetFile).replaceAll("\\", "/"),
  };
}

function parseArguments(args) {
  if (args.includes("--check")) {
    if (args.length !== 1) {
      fail("--check cannot be combined with other arguments.");
    }
    return { check: true };
  }

  const options = {};
  const allowed = new Set(["area", "guidance", "evidence"]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      fail(
        "Usage: record-learning.mjs --area <area> --guidance <text> --evidence <path[,path]>",
      );
    }
    const name = flag.slice(2);
    if (!allowed.has(name) || name in options) {
      fail(`Unknown or duplicate option: ${flag}`);
    }
    options[name] = value;
  }
  for (const name of allowed) {
    if (!options[name]) {
      fail(`Missing required option: --${name}`);
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = options.check
      ? checkLearningReference()
      : recordLearning({
          area: options.area,
          guidance: options.guidance,
          evidence: options.evidence,
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Learning was not recorded: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptFile)) {
  main();
}
