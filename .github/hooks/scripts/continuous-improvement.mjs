let rawInput = "";

for await (const chunk of process.stdin) {
  rawInput += chunk;
}

let input = {};
try {
  input = rawInput ? JSON.parse(rawInput) : {};
} catch {
  process.stdout.write("{}");
  process.exit(0);
}

const stopHookActive =
  input.stop_hook_active ?? input.stopHookActive ?? false;

if (stopHookActive) {
  process.stdout.write("{}");
  process.exit(0);
}

const reason = [
  "Perform one brief Orderak customization-gap audit before finishing.",
  "Use the orderak-agent-improvement skill.",
  "If this task revealed concise stable guidance supported by repository evidence, record it with the skill's deterministic record-learning command and validate it.",
  "Propose a reviewed structural update only when the shared learned guidance is insufficient for a repeatable workflow or policy gap.",
  "If the active agent is read-only, report the proposal instead of editing.",
  "Do not alter hooks, permissions, tools, personas, protected contracts, or security boundaries.",
  "Do not invent an improvement: if no justified gap exists, state that briefly and finish without customization changes.",
].join(" ");

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason,
  }),
);
