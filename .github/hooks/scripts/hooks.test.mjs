import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "../../..");

function run(script, input) {
  const result = spawnSync(process.execPath, [path.join(scriptsDirectory, script)], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: JSON.stringify(input),
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "{}");
}

test("session start emits current top-level context output", () => {
  const output = run("session-context.mjs", {});

  assert.match(output.additionalContext, /Repository: Orderak/);
  assert.equal("hookSpecificOutput" in output, false);
});

test("sensitive remote commands require approval", () => {
  const output = run("guard-sensitive-actions.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git push origin main" },
  });

  assert.equal(output.permissionDecision, "ask");
  assert.match(output.permissionDecisionReason, /explicit approval/);
});

test("customization edits require approval", () => {
  const output = run("guard-sensitive-actions.mjs", {
    tool_name: "Edit",
    tool_input: { file: ".github/agents/orderak-builder.agent.md" },
  });

  assert.equal(output.permissionDecision, "ask");
  assert.match(output.permissionDecisionReason, /AI instructions/);
});

test("ordinary reads fall through without a decision", () => {
  const output = run("guard-sensitive-actions.mjs", {
    tool_name: "Read",
    tool_input: { file: "README.md" },
  });

  assert.deepEqual(output, {});
});

test("first stop requests the improvement audit", () => {
  const output = run("continuous-improvement.mjs", {
    stop_hook_active: false,
  });

  assert.equal(output.decision, "block");
  assert.match(output.reason, /orderak-agent-improvement/);
  assert.match(output.reason, /record-learning/);
});

test("re-entered stop does not loop", () => {
  const output = run("continuous-improvement.mjs", {
    stop_hook_active: true,
  });

  assert.deepEqual(output, {});
});
