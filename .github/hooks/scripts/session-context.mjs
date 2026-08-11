import { execFileSync } from "node:child_process";

function runGit(args, fallback) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

const branch = runGit(["branch", "--show-current"], "unknown");
const status = runGit(["status", "--short"], "");
const changedFileCount = status
  ? status.split(/\r?\n/).filter(Boolean).length
  : 0;

const additionalContext = [
  "Repository: Orderak.",
  `Git branch: ${branch || "detached HEAD"}.`,
  `Working tree entries: ${changedFileCount}.`,
  "Read AGENTS.md and .github/copilot-instructions.md before editing.",
  "Relevant Orderak skills also consult the evidence-backed shared learned guidance.",
  "Preserve unrelated changes.",
  "Authentication and localization contracts require explicit approval for behavioral migrations.",
].join(" ");

process.stdout.write(
  JSON.stringify({
    additionalContext,
  }),
);
