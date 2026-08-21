---
status: archived
generated: false
owner: governance
applies_to: [internal]
---
# Tenant shard migration rehearsal evidence

## Identification

- Rehearsal: `staging synthetic` / `Orderak-owned production test`
- Date/operator/reviewer:
- Repository commit:
- Runbook revision and commit:
- Organization ID:
- Source shard / target shard:
- Source routing version / target routing version:
- Approved RTO / write-interruption limit:

## Workload and fence

- Concurrent workload used:
- Fence start/end and observed retryable responses:
- Measured write interruption:
- Writes observed after fence (must be zero):

## Copy and validation

| Tenant table | Source rows | Target rows | Source checksum | Target checksum | References valid |
|---|---:|---:|---|---|---|
|  |  |  |  |  |  |

- Outbox/event catch-up cursor and result:
- Routing flip versions and timestamps:
- Target smoke checks:
- Total elapsed time / measured RTO:

## Rollback proof

- Rollback invoked:
- New rollback routing version:
- Target-change drain result:
- Post-rollback counts/checksums:
- Rollback elapsed time and outcome:

## Findings

| Severity | Finding | Owner | Correction commit | Resolved |
|---|---|---|---|---|
|  |  |  |  |  |

- Unresolved findings:
- Reviewer decision:
- If rehearsal two: evidence that the runbook revision is newer than rehearsal
  one and includes its committed corrections:
