# Documentation guide

Orderak documentation is maintained with the code it describes. A change is
complete only when its code, tests, operational guidance, and documentation
agree.

## Choose the source of truth

Update the narrowest authoritative document instead of copying the same detail
into several files.

| Change | Authoritative document |
| --- | --- |
| Backend endpoint or payload | [`../api.md`](../reference/api.md) |
| Product behavior or screen flow | [`../app-plan.md`](../product/app-plan.md) |
| Installation, configuration, or deployment | [`../setup.md`](./setup.md) |
| System component or data flow | [`../architecture/overview.md`](../architecture/overview.md) |
| Authentication, authorization, or secrets | [`../architecture/security-model.md`](../architecture/security-model.md) |
| Database migration | [`database-migrations.md`](./database-migrations.md) |
| Localization contract | [`../localization-architecture.md`](../architecture/localization-architecture.md) |
| Operational recovery procedure | A focused runbook in `docs/runbooks/` |

The root and component README files should remain concise entry points. Link to
the authoritative guide for details that would otherwise be duplicated.

Use the authority order in [`../index.md`](../index.md#authority-order). Source
plans and historical reviews belong in the unpublished repository history and
must not carry a live implementation status.

Every current operational, product, architecture, or governance document should
state its owner, audience, status, and last verified date when those facts are
not already controlled by a register. Do not use a compound phrase such as
"implemented; approval pending" as approval evidence: implementation state and
decision authority are separate facts.

## Write for the reader

- Begin with the outcome or purpose, then provide prerequisites and steps.
- Use one term consistently; check [`../glossary.md`](../reference/glossary.md) for
  project terminology.
- Use ordered lists for sequences and bullets for unordered choices.
- Put commands in fenced code blocks and identify the shell (`cmd`, `bash`,
  `powershell`, `http`, or `json`).
- State the directory from which a command must run.
- Include expected results for destructive, production, or multi-step
  procedures.
- Use notes and warnings sparingly. A warning should identify a real risk and
  the safe action.
- Do not include secrets, private customer data, or real credentials in an
  example. Use clearly fake placeholders such as `<ADMIN_API_KEY>`.

## Link and heading conventions

- Use descriptive link text instead of "click here."
- Use relative links between repository documents.
- Include the `.md` extension so links work on GitHub and in local editors.
- From a page under `docs/`, use a full repository URL for files outside
  `docs/`; MkDocs cannot publish those files as relative targets.
- Keep heading text unique among siblings and avoid skipping heading levels.
- When renaming a heading, search for inbound `#anchor` links before committing.
- Mark unfinished content explicitly with an owner or tracking issue; do not
  leave ambiguous placeholder links.

## Keep examples accurate

Verify documentation against the implementation before submitting it:

- Backend commands and scripts: `services/backend/package.json`
- Worker bindings and routes: `services/backend/wrangler.jsonc`
- API behavior: `services/backend/src/` and its tests
- Android SDK versions and tasks: `apps/seller-android/app/build.gradle.kts`
- Android package name: `app.orderak.seller`
- Database order and schema: `services/backend/migrations/`

Never describe a planned feature as implemented. Label future behavior as
planned and link it to the relevant product plan or architecture decision.

## Validate changes

From the repository root, run the Markdown checks used by CI:

```cmd
pnpm run lint:markdown
```

CI also checks links with Lychee and builds the documentation site in strict
mode. If MkDocs is available locally, preview the site with:

```cmd
python -m mkdocs serve
```

For code-related documentation changes, run the affected backend or Android
tests from the [testing guide](./testing.md). Localization-related changes must
also pass `gradlew.bat :app:verifyLocalizationContract`.

## Review checklist

- The document answers who it is for and what outcome it enables.
- Commands, paths, environment variables, routes, and sample responses match
  the repository.
- Security-sensitive examples contain placeholders only.
- New or renamed pages are linked from [`../index.md`](../index.md) and
  `mkdocs.yml` when appropriate.
- Local links and anchors resolve.
- The related changelog entry is updated when the documentation change is
  user-visible or release-relevant.
