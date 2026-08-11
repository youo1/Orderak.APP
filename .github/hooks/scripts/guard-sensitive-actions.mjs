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

const toolName = String(input.tool_name ?? input.toolName ?? "").toLowerCase();
const toolInput = input.tool_input ?? input.toolInput ?? {};
const normalizedInput = JSON.stringify(toolInput)
  .replaceAll("\\", "/")
  .toLowerCase();

const isExecutionTool = /(bash|powershell|terminal|shell|command|execute|run)/.test(
  toolName,
);
const isEditTool = /(edit|replace|write|create|patch|delete|move)/.test(
  toolName,
);

let reason = "";

if (
  isExecutionTool &&
  /(wrangler\s+(deploy|delete|secret\s+(put|delete))|git\s+push|gh\s+pr\s+create|firebase\s+deploy)/.test(
    normalizedInput,
  )
) {
  reason = "Remote deployment, secret mutation, push, or pull-request actions require explicit approval.";
} else if (
  isExecutionTool &&
  /(git\s+reset\s+--hard|rm\s+-rf|remove-item[^]*-recurse|drop\s+table|delete\s+from)/.test(
    normalizedInput,
  )
) {
  reason = "This potentially destructive command requires manual review.";
} else if (
  isEditTool &&
  /(docs\/auth-phase1-contract\.md|docs\/localization-architecture\.md)/.test(
    normalizedInput,
  )
) {
  reason = "Protected authentication and localization contracts require explicit review before editing.";
} else if (
  isEditTool &&
  /(^|[/"'])(agents\.md|\.github\/(agents|skills|instructions|hooks|copilot|plugin)(\/|$)|\.github\/(copilot-instructions\.md|mcp\.json)|\.vscode\/(mcp|settings)\.json)/.test(
    normalizedInput,
  )
) {
  reason = "AI instructions, agents, skills, hooks, plugins, MCP, and tool settings require manual review before editing.";
} else if (
  isEditTool &&
  /(^|\/)(\.env|\.dev\.vars)(\.|\/|"|$)/.test(normalizedInput)
) {
  reason = "Environment and secret-bearing files require manual review before editing.";
}

if (reason) {
  process.stdout.write(
    JSON.stringify({
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    }),
  );
} else {
  process.stdout.write("{}");
}
