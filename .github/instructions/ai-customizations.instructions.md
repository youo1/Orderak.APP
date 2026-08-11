---
description: Schema, safety, and validation rules for Orderak AI customizations.
applyTo: ".github/agents/**,.github/skills/**,.github/instructions/**,.github/hooks/**,.github/copilot/**,.github/plugin/**,.github/mcp.json,.github/copilot-instructions.md"
---

# AI customization instructions

- Use the current GitHub Copilot formats for agents, skills, path instructions,
  hooks, MCP servers, repository settings, and plugin manifests.
- Keep agent tools least-privileged. Read-only personas must not receive edit
  tools, and remote or destructive actions still require explicit approval.
- Put stable policy in instructions, reusable workflows in skills, personas and
  tool scopes in agents, and deterministic lifecycle enforcement in hooks.
- Keep automatic learning append-only, evidence-backed, deduplicated, and
  constrained to
  `.github/skills/orderak-agent-improvement/references/learned-guidance.md`.
  Direct structural customization changes still require review.
- Never commit tokens, credentials, private endpoints, or production
  identifiers. Shared MCP variables must use the `COPILOT_MCP_` prefix and each
  server must have an explicit tool allowlist.
- Preserve protected authentication, localization, security, and documentation
  contracts.
- Run
  `node .github/skills/orderak-agent-improvement/scripts/record-learning.mjs --check`
  and
  `node .github/skills/orderak-agent-improvement/scripts/validate-customizations.mjs`
  after changes.
- Run
  `node --test .github/hooks/scripts/hooks.test.mjs .github/skills/orderak-agent-improvement/scripts/record-learning.test.mjs`
  after learning or hook changes.
