---
name: orderak-agent-improvement
description: Audit completed Orderak tasks for stable missing instructions or reusable workflows, record evidence-backed learning, and validate the smallest valuable customization. Use automatically once at the end of every task.
---

# Orderak agent improvement

Perform this audit after the requested work is complete. The audit must not
delay or replace the user's actual task.

## 1. Require evidence

Consider an improvement only when the completed task exposed at least one of:

- A stable repository rule confirmed by code, documentation, contracts, tests,
  or an explicit user decision.
- A repeated error or omission that a concise instruction would prevent.
- A multi-step workflow likely to recur that would benefit from instructions,
  a script, checklist, template, or reference material.
- A verification sequence that is easy to execute incorrectly by hand.

Do not encode one-off task details, guesses, temporary failures, conversation
history, generated output, or facts that are likely to become stale quickly.

Before auditing, read the shared
[learned guidance](./references/learned-guidance.md). Treat it as subordinate
to the repository contracts and current implementation.

## 2. Choose the smallest customization

| Gap | Correct location |
| --- | --- |
| Concise evidence-backed guidance for an existing project area | Record it in the shared learned guidance |
| Rule needed for nearly every task | `.github/copilot-instructions.md` |
| Stable rule for a file type or project area | `.github/instructions/*.instructions.md` with a narrow `applyTo` glob |
| Reusable procedure, script, checklist, template, or reference | `.github/skills/<skill-name>/` |
| New recurring professional persona | Do not create automatically; request explicit user approval |
| Deterministic lifecycle enforcement | Do not change hooks automatically |
| Tool access or approval behavior | Do not change automatically |

Prefer extending an existing instruction or skill over creating a near
duplicate.

## 3. Record safe learning automatically

When the evidence supports a concise reusable lesson, use the deterministic
recorder:

```powershell
node .github/skills/orderak-agent-improvement/scripts/record-learning.mjs --area <repository|android|backend|admin-web|documentation|verification> --guidance "<stable guidance>" --evidence "<repository/path[:line][,another/path]>"
```

The recorder writes only to the shared learned-guidance reference, validates
repository-relative evidence, rejects likely secrets and unsafe guidance,
deduplicates entries, and caps every area. This exact recorder command may run
without a separate approval prompt; all other customization edits retain their
normal review boundary.

Do not record a lesson when it merely restates an existing contract,
instruction, or learned entry. Direct structural changes to an instruction,
skill workflow, agent, hook, tool, or permission remain reviewed changes.

## 4. Apply safety constraints

- Do not weaken `AGENTS.md`, protected contracts, verification guards, auth,
  tenant isolation, localization architecture, secret handling, or
  documentation synchronization.
- Do not add secrets, tokens, private URLs, personal data, production
  identifiers, or raw logs.
- Do not grant tools, enable auto-approval, change hooks, or broaden agent
  permissions.
- Do not create an instruction that conflicts with the actual implementation.
- Read-only agents must report a concrete proposal rather than editing.
- Editing agents must explain the reusable evidence and allow VS Code to
  request approval for structural customization-file changes.

## 5. Follow format rules

For an instruction:

- Keep it concise, imperative, and repository-specific.
- Use the narrowest correct `applyTo` glob for path instructions.

For a skill:

- The folder and `name` must match.
- Use only lowercase letters, numbers, and hyphens in the name.
- Make the description explicit about both capability and trigger.
- Reference every bundled script, template, checklist, or resource from
  `SKILL.md`.
- Keep scripts deterministic, non-destructive, and free of secrets.

## 6. Validate and report

After a recorded lesson or approved structural edit, run:

```powershell
node .github/skills/orderak-agent-improvement/scripts/record-learning.mjs --check
node .github/skills/orderak-agent-improvement/scripts/validate-customizations.mjs
```

Report one of:

- `Learning recorded:` the guidance and repository evidence.
- `Improvement added:` what changed and the reusable evidence.
- `Improvement proposed:` the exact change awaiting approval or an editing
  agent.
- `No customization gap:` no stable, reusable improvement was justified.
