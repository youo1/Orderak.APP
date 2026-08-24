---
name: orderak-repository-architecture
description: Perform a first-principles, evidence-based read-only audit of repository architecture, dependencies, dead code, security posture, scalability, and technical debt, producing actionable recommendations. Use for full or focused architecture reviews.
---

# Orderak repository architecture review

A read-only, evidence-based audit. Treat the repository as unknown at the
start and challenge assumptions without being performative: every material
claim must cite repository evidence, a reproducible check, or an explicitly
stated assumption.

Follow `AGENTS.md` and `.github/copilot-instructions.md` as the governing
contracts, and never violate their protected-contract requirements.

## Safety and scope

- Do not edit files, run commands, install dependencies, deploy, publish, push,
  commit, or change remote state.
- You cannot execute commands from this workflow. For checks that require
  running tests, builds, lint, or dependency analysis, name the exact command
  and what it would establish, and ask the user or an implementation agent to
  run it. Never claim that an unexecuted check passed.
- Never expose secrets, tokens, private URLs, personal data, production
  identifiers, or sensitive logs. Redact them and record only location and risk.
- Do not label code dead solely because it has no obvious local references;
  account for dynamic imports, reflection, route registration, generated code,
  plugins, configuration, tests, and CLI entry points.
- Separate facts, inferences, assumptions, recommendations, and unknowns. Mark
  confidence as high, medium, or low.
- Do not invent vulnerabilities, dependencies, stakeholders, or requirements.

## Method

1. Establish scope and a clean baseline: repository root, instruction files,
   manifests, lockfiles, CI, build scripts, entry points, deployment config,
   and test config.
2. Identify languages, runtimes, frameworks, package boundaries, deployable
   units, data stores, external services, and trust boundaries.
3. Build a module map from actual imports, exports, routes, registrations,
   manifests, and configuration.
4. Trace critical flows end to end: startup, auth/z, validation, persistence,
   third-party calls, background work, error handling, logging, output.
5. Use static search to test hypotheses about unused code, cycles, duplicated
   logic, unreachable branches, insecure defaults, and stale documentation.
   Recommend exact commands where an executable check is needed.
6. Read nearby tests and documentation to distinguish intended from accidental
   behavior.

When the repository is large, sample by architectural boundary and risk, state
coverage, and never claim a whole-repository result from a partial scan.

## Output format

Return, in order:

1. **Executive Summary** — objective, scope, coverage, verdict, top risks,
   three highest-value next actions.
2. **Architecture Diagram** — text-based Mermaid where useful, plus trust
   boundaries and data authority.
3. **Component Breakdown** — module map, responsibilities, dependency
   relationships, critical data flows, integrations, dead-code candidates,
   design-pattern violations, documentation/onboarding gaps.
4. **Risk Matrix** — severity, likelihood, evidence, failure scenario, impact,
   confidence, mitigation, effort for each material finding.
5. **Security Assessment** — threat model, controls, weaknesses, secret and
   data-leakage assessment, compliance questions, verification gaps.
6. **Scalability Assessment** — bottlenecks, cost model, scaling options,
   caching, resilience, monitoring recommendations.
7. **Recommended Tech Stack** — retain/replace/introduce only where evidence
   supports it; include tradeoffs and reasons not to change stable components.
8. **Implementation Plan** — MVP, hardening, evolution, with prioritized
   refactoring, proposed docs, ADRs, tests, and measurable success criteria.
9. **Final Verdict** — viability, conditions to proceed, residual risks, next
   smallest discriminating checks.

End with **Assumptions and Unknowns**, **Evidence Coverage**, and **Checks
Recommended**. Never imply generated docs or ADRs were written to disk; provide
draft content or file recommendations unless separately authorized.

Use the
[verification matrix](../orderak-verification/references/verification-matrix.md)
to name any checks the audit requires.
