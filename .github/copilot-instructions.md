# Orderak repository instructions

Treat the root [AGENTS.md](../AGENTS.md) as the authoritative repository
contract. Inspect relevant code, tests, and documentation before editing.

- Keep changes small, beginner-friendly, and consistent with nearby patterns.
- Preserve unrelated work in a dirty working tree.
- Android uses Kotlin and Jetpack Compose and calls only the Cloudflare backend.
- The Cloudflare Workers backend owns provider integrations, secrets, data
  access, authentication enforcement, and third-party API calls.
- Never place credentials or provider secrets in Android code, source control,
  examples, tests, or logs.
- Do not deploy, publish, push, create pull requests, or change remote state
  unless the user explicitly requests it.
- Treat `docs/contracts/auth-phase1-contract.md` and
  `docs/architecture/localization-architecture.md` as protected contracts. Obtain explicit
  approval before changing their protected behavior.
- Never bypass, weaken, rename, or remove contract verification tasks.
- Update the documentation named in `AGENTS.md` whenever product behavior,
  endpoints, setup, architecture, security, or migrations change.
- Run the narrowest relevant tests and report commands actually executed. Do
  not claim that an unexecuted check passed.

Load the relevant Orderak skill automatically when a task concerns Android,
the admin frontend, services/backend/API work, or verification.

## Capability model

- MCP tool access is least-privilege. Every server in `.github/mcp.json` is
  allowlisted to an explicit, read-only default set; mutation/build tools are
  granted only where a documented task requires them and are scoped to the
  smallest server/agent combination.
- Read-only personas (Planner, Docs, Security Reviewer, and any architecture
  review) receive only read-oriented tools. They never hold `execute`, `edit`,
  or remote/destructive capabilities, and they name verification commands for
  others to run rather than running them.
- Do not add server wildcards (`"tools": ["*"]` or `server/*`) to an agent's
  tool list. Grant named tools only, and default a new server to read-only
  until a concrete task is shown to need mutation.

## Agents and skills

- A custom agent defines a selectable persona, scope, behavior, and tool
  boundary.
- A skill defines a reusable workflow, checklist, script, or reference that can
  be loaded by any compatible agent when relevant.
- Use `Orderak Builder` for cross-cutting implementation and the Android,
  admin-web, or backend agents for focused ownership. Their matching
  skills supply the repeatable procedures and verification details.
- Keep shared policy in these global or path-specific instructions instead of
  duplicating it across every agent and skill.

## Continuous improvement

Before completing a task, perform one brief customization-gap audit using the
`orderak-agent-improvement` skill.

- Record concise, stable, evidence-backed guidance with the skill's
  deterministic learning recorder. Relevant Orderak skills automatically read
  that shared guidance on later tasks.
- Add or update an instruction only for stable, repository-specific guidance
  supported by the code, contracts, documentation, or a confirmed user
  decision.
- Add or update a skill only for a reusable multi-step workflow that is likely
  to recur and materially improves correctness or efficiency.
- Do not create content merely to satisfy the audit. Prefer no change over
  speculative, duplicated, task-specific, or low-value customization.
- Never self-modify protected contracts, hooks, tool permissions, broad
  approval settings, security boundaries, or agent personas through this
  audit.
- Never store secrets, personal data, private identifiers, or transient command
  output in a customization.
- Keep proposed changes minimal and validate the customization structure.
- If the active agent is read-only, report the proposed improvement instead of
  editing files.

The fixed learning-recorder command is the only automatic customization write.
Structural customization edits require manual approval in VS Code. Clearly
explain why an improvement is reusable before asking the user to approve it.
