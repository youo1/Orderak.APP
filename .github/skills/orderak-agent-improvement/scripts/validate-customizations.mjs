import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const githubRoot = path.join(repositoryRoot, ".github");
const errors = [];

function relative(file) {
  return path.relative(repositoryRoot, file).replaceAll("\\", "/");
}

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function parseFrontmatter(file, { required = true } = {}) {
  const content = read(file);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    if (required) {
      errors.push(`${relative(file)}: missing YAML frontmatter`);
    }
    return { content, fields: new Map(), header: "", body: content };
  }

  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][a-zA-Z0-9-]*):\s*(.*)$/);
    if (field) {
      fields.set(field[1], field[2].trim());
    }
  }

  return {
    content,
    fields,
    header: match[1],
    body: content.slice(match[0].length),
  };
}

function scalar(fields, key) {
  const value = fields.get(key);
  return value?.replace(/^(['"])(.*)\1$/, "$2").trim();
}

function requireField(file, fields, field) {
  if (!scalar(fields, field)) {
    errors.push(`${relative(file)}: missing ${field} field`);
  }
}

function parseJson(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    errors.push(`${relative(file)}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function validateRelativeLinks(file) {
  const links = read(file).matchAll(
    /\]\((?!https?:\/\/|#|mailto:)([^)#]+)(?:#[^)]+)?\)/g,
  );

  for (const link of links) {
    const target = path.resolve(path.dirname(file), link[1]);
    if (!fs.existsSync(target)) {
      errors.push(`${relative(file)}: broken link ${link[1]}`);
    }
  }
}

function validateJavaScript(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    errors.push(
      `${relative(file)}: JavaScript syntax error (${result.stderr.trim()})`,
    );
  }
}

function validateAgentProfiles() {
  const directory = path.join(githubRoot, "agents");
  const files = walk(directory).filter((file) => file.endsWith(".agent.md"));

  if (files.length === 0) {
    errors.push(".github/agents: no custom agent profiles found");
  }

  for (const file of files) {
    const { content, fields, body } = parseFrontmatter(file);
    for (const field of ["name", "description", "tools"]) {
      requireField(file, fields, field);
    }

    const target = scalar(fields, "target");
    if (target && !["vscode", "github-copilot"].includes(target)) {
      errors.push(`${relative(file)}: unsupported target ${target}`);
    }
    if (content.length > 30_000) {
      errors.push(`${relative(file)}: agent profile exceeds 30,000 characters`);
    }
    if (!body.trim()) {
      errors.push(`${relative(file)}: empty agent instructions`);
    }
    if (/\btarget:\s*vscode\b/.test(content)) {
      errors.push(
        `${relative(file)}: target:vscode prevents use by Copilot cloud agent`,
      );
    }
    if (/tools:\s*\[[^\]]*['"]vscode['"]/.test(content)) {
      errors.push(`${relative(file)}: tools contains unsupported alias vscode`);
    }
    const allowedFields = new Set([
      "name",
      "description",
      "argument-hint",
      "target",
      "tools",
      "model",
      "disable-model-invocation",
      "user-invocable",
      "mcp-servers",
      "metadata",
      "handoffs",
    ]);
    for (const field of fields.keys()) {
      if (!allowedFields.has(field)) {
        errors.push(`${relative(file)}: unsupported agent field ${field}`);
      }
    }
    validateRelativeLinks(file);
  }
}

function validateSkills() {
  const directory = path.join(githubRoot, "skills");
  const files = walk(directory).filter(
    (file) => path.basename(file) === "SKILL.md",
  );

  if (files.length === 0) {
    errors.push(".github/skills: no skills found");
  }

  for (const file of files) {
    const { content, fields, body } = parseFrontmatter(file);
    const directoryName = path.basename(path.dirname(file));
    const skillName = scalar(fields, "name");

    requireField(file, fields, "name");
    requireField(file, fields, "description");
    if (skillName !== directoryName) {
      errors.push(
        `${relative(file)}: skill name must match directory ${directoryName}`,
      );
    }
    if (!/^[a-z0-9-]{1,64}$/.test(skillName ?? "")) {
      errors.push(`${relative(file)}: invalid skill name`);
    }
    if (!body.trim()) {
      errors.push(`${relative(file)}: empty skill instructions`);
    }
    if (/\[TODO(?::|\])/i.test(content)) {
      errors.push(`${relative(file)}: unresolved TODO placeholder`);
    }
    for (const field of fields.keys()) {
      if (!["name", "description", "license"].includes(field)) {
        errors.push(`${relative(file)}: unsupported skill field ${field}`);
      }
    }
    validateRelativeLinks(file);
  }

  for (const file of walk(directory).filter(
    (item) => item.endsWith(".mjs") && !item.endsWith(".test.mjs"),
  )) {
    validateJavaScript(file);
  }

  const learnedGuidanceLink =
    "../orderak-agent-improvement/references/learned-guidance.md";
  for (const skillName of [
    "orderak-android",
    "orderak-backend",
    "orderak-admin-web",
    "orderak-verification",
  ]) {
    const skillFile = path.join(directory, skillName, "SKILL.md");
    if (
      fs.existsSync(skillFile) &&
      !read(skillFile).includes(learnedGuidanceLink)
    ) {
      errors.push(
        `${relative(skillFile)}: must consult the shared learned guidance`,
      );
    }
  }

  const learningScript = path.join(
    directory,
    "orderak-agent-improvement",
    "scripts",
    "record-learning.mjs",
  );
  if (!fs.existsSync(learningScript)) {
    errors.push(
      ".github/skills/orderak-agent-improvement: learning recorder is missing",
    );
  } else {
    const result = spawnSync(process.execPath, [learningScript, "--check"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      errors.push(
        `.github/skills/orderak-agent-improvement: invalid learned guidance (${result.stderr.trim()})`,
      );
    }
  }

  const updateWorkflow = path.join(
    githubRoot,
    "workflows",
    "skills-auto-update.yml",
  );
  if (!fs.existsSync(updateWorkflow)) {
    errors.push(".github/workflows: skills auto-update workflow is missing");
  } else {
    const workflow = read(updateWorkflow);
    for (const requirement of [
      ["weekly schedule", /\bschedule:/],
      [
        "metadata-tracked skill update",
        /\bgh skill update --all --dir \.github\/skills\b/,
      ],
      ["review pull request", /\bgh pr create\b/],
    ]) {
      if (!requirement[1].test(workflow)) {
        errors.push(
          `${relative(updateWorkflow)}: missing ${requirement[0]}`,
        );
      }
    }
    if (/\bgh pr (?:merge|review --approve)\b/.test(workflow)) {
      errors.push(
        `${relative(updateWorkflow)}: automated skill updates must not approve or merge themselves`,
      );
    }
  }
}

function validateInstructions() {
  const instructionsDirectory = path.join(githubRoot, "instructions");
  const files = walk(instructionsDirectory).filter((file) =>
    file.endsWith(".instructions.md"),
  );
  const applyToValues = new Set();

  for (const file of files) {
    const { fields, body } = parseFrontmatter(file);
    requireField(file, fields, "applyTo");
    const applyTo = scalar(fields, "applyTo");
    if (applyTo) {
      applyToValues.add(applyTo);
    }
    if (!body.trim()) {
      errors.push(`${relative(file)}: empty path-specific instructions`);
    }
    for (const field of fields.keys()) {
      if (!["description", "applyTo", "excludeAgent"].includes(field)) {
        errors.push(`${relative(file)}: unsupported instruction field ${field}`);
      }
    }
    validateRelativeLinks(file);
  }

  for (const expected of [
    "apps/seller-android/**",
    "services/backend/**",
    "apps/admin-web/**",
    "docs/**",
  ]) {
    if (!applyToValues.has(expected)) {
      errors.push(
        `.github/instructions: missing path-specific coverage for ${expected}`,
      );
    }
  }
  if (
    !files.some(
      (file) => path.basename(file) === "ai-customizations.instructions.md",
    )
  ) {
    errors.push(
      ".github/instructions: missing AI customization governance instructions",
    );
  }

  const globalInstructions = path.join(githubRoot, "copilot-instructions.md");
  if (!fs.existsSync(globalInstructions)) {
    errors.push(".github/copilot-instructions.md: file is required");
    return;
  }

  const global = parseFrontmatter(globalInstructions, { required: false });
  if (global.header) {
    errors.push(
      ".github/copilot-instructions.md: repository-wide instructions must not use path frontmatter",
    );
  }
  if (!global.content.trim()) {
    errors.push(".github/copilot-instructions.md: file is empty");
  }
  validateRelativeLinks(globalInstructions);
}

const hookEvents = new Set([
  "agentStop",
  "errorOccurred",
  "notification",
  "permissionRequest",
  "postToolUse",
  "postToolUseFailure",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStart",
  "subagentStop",
  "userPromptSubmitted",
  "userPromptTransformed",
  "Stop",
  "PreToolUse",
  "SessionStart",
]);

function validateHooks() {
  const hooksDirectory = path.join(githubRoot, "hooks");
  const files = walk(hooksDirectory).filter((file) => file.endsWith(".json"));

  if (files.length === 0) {
    errors.push(".github/hooks: no hook configuration found");
  }

  for (const file of files) {
    const config = parseJson(file);
    if (!config) {
      continue;
    }
    if (config.version !== 1) {
      errors.push(`${relative(file)}: hook version must be 1`);
    }
    if (!config.hooks || typeof config.hooks !== "object") {
      errors.push(`${relative(file)}: hooks must be an object`);
      continue;
    }

    for (const [event, entries] of Object.entries(config.hooks)) {
      if (!hookEvents.has(event)) {
        errors.push(`${relative(file)}: unsupported hook event ${event}`);
      }
      if (!Array.isArray(entries)) {
        errors.push(`${relative(file)}: ${event} must be an array`);
        continue;
      }

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          errors.push(`${relative(file)}: ${event} has a non-object entry`);
          continue;
        }
        const type = entry.type ?? "command";
        if (!["command", "http", "prompt"].includes(type)) {
          errors.push(`${relative(file)}: ${event} has invalid type ${type}`);
        }
        if (
          type === "command" &&
          ![entry.command, entry.bash, entry.powershell].some(
            (value) => typeof value === "string" && value.trim(),
          )
        ) {
          errors.push(`${relative(file)}: ${event} command is missing`);
        }
        if (type === "http" && !/^https:\/\//.test(entry.url ?? "")) {
          errors.push(`${relative(file)}: ${event} HTTP hook must use HTTPS`);
        }
        if (type === "prompt" && !String(entry.prompt ?? "").trim()) {
          errors.push(`${relative(file)}: ${event} prompt is missing`);
        }

        for (const command of [
          entry.command,
          entry.bash,
          entry.powershell,
        ].filter((value) => typeof value === "string")) {
          const script = command.match(
            /\bnode\s+["']?([^"' ]+\.(?:mjs|js|cjs))["']?/,
          )?.[1];
          if (
            script &&
            !script.includes("${") &&
            !fs.existsSync(path.resolve(repositoryRoot, script))
          ) {
            errors.push(`${relative(file)}: missing hook script ${script}`);
          }
        }
      }
    }
  }

  for (const file of walk(path.join(hooksDirectory, "scripts")).filter((item) =>
    item.endsWith(".mjs") && !item.endsWith(".test.mjs"),
  )) {
    const content = read(file);
    if (content.includes("hookSpecificOutput")) {
      errors.push(`${relative(file)}: obsolete hookSpecificOutput wrapper`);
    }
    validateJavaScript(file);
  }
}

function validateMcp(file, { shared }) {
  if (!fs.existsSync(file)) {
    errors.push(`${relative(file)}: MCP configuration is missing`);
    return;
  }
  const config = parseJson(file);
  if (!config) {
    return;
  }
  if (
    !config.mcpServers ||
    typeof config.mcpServers !== "object" ||
    Array.isArray(config.mcpServers)
  ) {
    errors.push(`${relative(file)}: mcpServers must be an object`);
    return;
  }

  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!server || typeof server !== "object") {
      errors.push(`${relative(file)}: MCP server ${name} must be an object`);
      continue;
    }
    if (shared) {
      if (!["local", "stdio", "http", "sse"].includes(server.type)) {
        errors.push(`${relative(file)}: MCP server ${name} has invalid type`);
      }
      if (!Array.isArray(server.tools) || server.tools.length === 0) {
        errors.push(
          `${relative(file)}: MCP server ${name} needs an explicit tools allowlist`,
        );
      }
    }
    const serialized = JSON.stringify(server);
    for (const variable of serialized.matchAll(
      /\$\{?([A-Z][A-Z0-9_]*)[^A-Z0-9_]?/g,
    )) {
      if (shared && !variable[1].startsWith("COPILOT_MCP_")) {
        errors.push(
          `${relative(file)}: MCP variable ${variable[1]} must start with COPILOT_MCP_`,
        );
      }
    }
  }
}

function validatePluginConfiguration() {
  const settingsFile = path.join(githubRoot, "copilot", "settings.json");
  const settings = parseJson(settingsFile);
  if (settings) {
    for (const key of ["enabledPlugins", "extraKnownMarketplaces"]) {
      if (
        !settings[key] ||
        typeof settings[key] !== "object" ||
        Array.isArray(settings[key])
      ) {
        errors.push(`${relative(settingsFile)}: ${key} must be an object`);
      }
    }
  }

  const manifestFile = path.join(githubRoot, "plugin", "plugin.json");
  const manifest = parseJson(manifestFile);
  if (manifest) {
    if (!/^[a-z0-9-]{1,64}$/.test(manifest.name ?? "")) {
      errors.push(`${relative(manifestFile)}: invalid plugin name`);
    }
    if (
      manifest.version &&
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
    ) {
      errors.push(`${relative(manifestFile)}: invalid semantic version`);
    }
    for (const key of ["agents", "skills"]) {
      const values = Array.isArray(manifest[key])
        ? manifest[key]
        : [manifest[key]];
      for (const value of values) {
        if (
          typeof value !== "string" ||
          !fs.existsSync(path.resolve(repositoryRoot, value))
        ) {
          errors.push(
            `${relative(manifestFile)}: ${key} path does not exist (${value})`,
          );
        }
      }
    }
    if (
      manifest.mcpServers &&
      (typeof manifest.mcpServers !== "string" ||
        !fs.existsSync(path.resolve(repositoryRoot, manifest.mcpServers)))
    ) {
      errors.push(
        `${relative(manifestFile)}: mcpServers path does not exist (${manifest.mcpServers})`,
      );
    }
  }

  const marketplaceFile = path.join(
    githubRoot,
    "plugin",
    "marketplace.json",
  );
  const marketplace = parseJson(marketplaceFile);
  if (marketplace) {
    if (!/^[a-z0-9.-]{1,64}$/.test(marketplace.name ?? "")) {
      errors.push(`${relative(marketplaceFile)}: invalid marketplace name`);
    }
    if (!marketplace.owner?.name) {
      errors.push(`${relative(marketplaceFile)}: owner.name is required`);
    }
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
      errors.push(`${relative(marketplaceFile)}: plugins must be non-empty`);
    } else {
      for (const plugin of marketplace.plugins) {
        if (!/^[a-z0-9.-]{1,64}$/.test(plugin.name ?? "")) {
          errors.push(`${relative(marketplaceFile)}: invalid plugin entry name`);
        }
        if (
          typeof plugin.source !== "string" ||
          !fs.existsSync(path.resolve(repositoryRoot, plugin.source))
        ) {
          errors.push(
            `${relative(marketplaceFile)}: plugin source does not exist (${plugin.source})`,
          );
        }
        if (manifest && plugin.name === manifest.name) {
          if (plugin.version !== manifest.version) {
            errors.push(
              `${relative(marketplaceFile)}: ${plugin.name} version must match plugin.json`,
            );
          }
        }
      }
    }
  }
}

validateAgentProfiles();
validateSkills();
validateInstructions();
validateHooks();
validateMcp(path.join(githubRoot, "mcp.json"), { shared: true });
validateMcp(path.join(repositoryRoot, ".vscode", "mcp.json"), {
  shared: false,
});
validatePluginConfiguration();

const vscodeSettingsFile = path.join(repositoryRoot, ".vscode", "settings.json");
if (fs.existsSync(vscodeSettingsFile)) {
  const settings = parseJson(vscodeSettingsFile);
  const learningApproval =
    "/^node\\s+\\.github[\\\\/]skills[\\\\/]orderak-agent-improvement[\\\\/]scripts[\\\\/]record-learning\\.mjs(?:\\s|$)/";
  if (settings?.["chat.tools.terminal.autoApprove"]?.[learningApproval] !== true) {
    errors.push(
      ".vscode/settings.json: the fixed learning recorder command must be the approved terminal rule",
    );
  }
}

const vscodeExtensionsFile = path.join(
  repositoryRoot,
  ".vscode",
  "extensions.json",
);
if (fs.existsSync(vscodeExtensionsFile)) {
  parseJson(vscodeExtensionsFile);
}

if (errors.length > 0) {
  console.error("Orderak customization validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Orderak customization validation passed.");
