---
status: current
generated: false
owner: backend
last_verified: 2026-08-12
applies_to: [production, staging]
---
# Design-system fallback and rollback runbook

## Trigger

Investigate immediately when the error log contains
`context=design_system_fallback` or structured logs contain
`signal=design_system_fallback`. Configure a high-severity Cloudflare alert when
the signal repeats within five minutes.

## Safety rules

- Do not edit a published revision row.
- Do not manually point state at an unvalidated snapshot.
- Keep `/api/v1/theme` and hashed CSS public; the incident response must not add
  authentication that would break Android or render-blocking CSS.
- Preserve the legacy projection until the schema-v2 Android minimum-version
  gate is enforced.

## Diagnosis

1. Check the Admin Errors page for the first fallback event and request path.
2. Query `design_system_state` and its joined active revision.
3. Confirm `status`, schema/generator versions, JSON parseability, validation
   summary, content hash, and payload size.
4. Request `/api/v1/theme` and `/api/theme.css` without cache and verify matching
   hashes and a complete v2 payload.
5. Check the latest `design_system.published`, `.revision_activated`,
   `.revision_named`, `.revision_deleted`, `.publish_conflict`, and
   `.fallback_activated` audit evidence.

## Recovery

If the active revision is valid but cache propagation is stale, purge only the
stable theme lookup and wait for the 60-second worker cache. Immutable hashed
assets must not be overwritten.

If the active revision is corrupt:

1. Sign in as an owner with MFA.
2. Open Design system → Revision history.
3. Select the last known-good saved configuration or checkpoint and choose
   **Make current**.
4. Confirm the new revision ID is active; the historical row remains unchanged.
5. Verify admin, landing, catalog, legal, and both `/api/v1/theme` endpoints.
6. Foreground a test Android build twice: the first fetches pending, the second
   applies it.

If the revision tables are empty immediately after migration 035, deploy the
Worker and run `pnpm run design-system:seed` from `services/backend/`. The bootstrap is
idempotent and derives revision 1 from the effective legacy `theme_colors`.

If bootstrap created an invalid active snapshot, preserve that immutable
revision and create a corrective revision from a reviewed local source file:

1. Save the reviewed source JSON outside version control; do not include secrets.
2. From `services/backend/`, run
   `pnpm run design-system:recovery-sql -- <input.json> <output.sql>`.
3. Review the generated hash, validation summary, base revision, and SQL.
4. Apply it with
   `npx wrangler d1 execute orderak-db --remote --file <output.sql>`.
5. Delete the local input and generated SQL after confirming the new revision.
6. Verify the public JSON/CSS, active pointer, validation status, and audit logs.

The recovery SQL inserts a new immutable revision and moves the active pointer
only if the expected base revision still matches. It never edits the bad
historical revision.

## Closeout

Record the corrupt revision ID/hash, cause, affected interval, newly activated
revision, verification results, and alert disposition. Add a regression fixture
before applying another configuration.
