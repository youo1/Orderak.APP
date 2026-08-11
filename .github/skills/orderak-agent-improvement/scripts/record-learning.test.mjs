import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkLearningReference,
  recordLearning,
} from "./record-learning.mjs";

const skillDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const referenceTemplate = path.join(
  skillDirectory,
  "references",
  "learned-guidance.md",
);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orderak-learning-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "rule.md"),
    "# Rule\n\nStable repository evidence.\n",
  );
  const targetFile = path.join(root, "learned-guidance.md");
  fs.copyFileSync(referenceTemplate, targetFile);

  // The fixture copies the *real* guidance file, so every evidence path it
  // already cites must exist under this synthetic root — otherwise
  // checkLearningReference rejects content that is perfectly valid in the
  // repository. That is not hypothetical: recording a rule citing
  // `multi-agent/start_all.cmd` broke this test while the file existed and the
  // guidance was correct.
  //
  // Materialising the cited paths from the file itself keeps the test honest as
  // new guidance is recorded, instead of failing the next time someone cites a
  // path this fixture did not happen to create.
  // A path can be cited more than once at different line numbers, so collect the
  // largest before writing — sizing to whichever citation happened to come first
  // leaves the file too short for the others.
  const evidenceLines = new Map();
  for (const match of fs.readFileSync(targetFile, "utf8").matchAll(/`([^`\s]+\/[^`\s]+)`/g)) {
    const [cited, line] = match[1].split(":");
    evidenceLines.set(cited, Math.max(evidenceLines.get(cited) ?? 1, Number(line) || 1));
  }
  for (const [cited, line] of evidenceLines) {
    const evidencePath = path.join(root, cited);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, "fixture evidence\n".repeat(line + 1));
  }

  return { root, targetFile };
}

test("records and validates evidence-backed guidance", () => {
  const { root, targetFile } = fixture();
  const result = recordLearning({
    area: "repository",
    guidance: "Keep reusable repository rules grounded in checked-in evidence.",
    evidence: "docs/rule.md:3",
    repositoryRoot: root,
    targetFile,
  });

  assert.equal(result.status, "added");
  assert.match(
    fs.readFileSync(targetFile, "utf8"),
    /Keep reusable repository rules grounded/,
  );
  assert.equal(
    checkLearningReference({ targetFile, repositoryRoot: root }).status,
    "valid",
  );
});

test("returns duplicate without writing another entry", () => {
  const { root, targetFile } = fixture();
  const input = {
    area: "verification",
    guidance: "Run the focused verifier before the broader verification group.",
    evidence: "docs/rule.md",
    repositoryRoot: root,
    targetFile,
  };

  assert.equal(recordLearning(input).status, "added");
  assert.equal(recordLearning(input).status, "duplicate");
  assert.equal(
    fs.readFileSync(targetFile, "utf8").match(/Run the focused verifier/g).length,
    1,
  );
});

test("rejects missing evidence and unsafe guidance", () => {
  const { root, targetFile } = fixture();

  assert.throws(
    () =>
      recordLearning({
        area: "backend",
        guidance: "Keep backend behavior grounded in a repository source file.",
        evidence: "docs/missing.md",
        repositoryRoot: root,
        targetFile,
      }),
    /does not exist/,
  );
  assert.throws(
    () =>
      recordLearning({
        area: "backend",
        guidance: "Bypass authentication validation when local testing is slow.",
        evidence: "docs/rule.md",
        repositoryRoot: root,
        targetFile,
      }),
    /may not weaken/,
  );
});
