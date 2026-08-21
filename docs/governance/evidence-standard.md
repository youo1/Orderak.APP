---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Evidence repository and naming standard

This standard defines what counts as completion evidence and where it may be
stored. It applies to every launch requirement, gate, finding, risk acceptance,
incident, and production change.

## Evidence locations

| Tier | Location | Permitted content | Prohibited content |
| --- | --- | --- | --- |
| Repository evidence | `docs/governance/evidence/` and authoritative project docs | Sanitized decisions, test summaries, checklists, diagrams, hashes, public policy versions | Secrets, tokens, OTPs, customer records, private keys, unredacted contracts, identity documents |
| Restricted company evidence | Company-controlled access-restricted vault selected by the executive sponsor | Signed agreements, company records, DPO credentials, legal opinions, tax/bank records, regulator correspondence, incident detail | Unmanaged personal drives or public repository content |
| External system evidence | Cloudflare, Firebase, Google Play, GAFI, tax, banking, ticketing, and vendor consoles | Authoritative configuration and transaction records | Screenshots as the only evidence when export or signed record is available |

The restricted vault has not been selected in repository evidence. Until it is,
store only sanitized references in Git and track the missing vault as `ISS-004`.

## Repository structure

```text
docs/governance/
|-- index.md
|-- program-charter.md
|-- raci.md
|-- operating-cadence.md
|-- evidence-standard.md
|-- temporary-change-freeze.md
|-- source-plan-traceability.md
|-- evidence/
|   `-- YYYY-MM-DD-<subject>.md
`-- registers/
    |-- index.md
    |-- requirements-register.md
    |-- decision-log.md
    |-- risk-register.md
    |-- issue-and-change-log.md
    |-- third-party-and-permission-register.md
    |-- policy-version-register.md
    `-- findings-register.md
```

## Identifier convention

| Artifact | Format | Example |
| --- | --- | --- |
| Requirement | `REQ-<workstream>-NNN` | `REQ-GOV-001` |
| Assumption | `ASM-NNN` | `ASM-001` |
| Decision | `DEC-NNN` | `DEC-001` |
| Risk | `R-NNN` | `R-003` |
| Issue | `ISS-NNN` | `ISS-005` |
| Change | `CHG-NNN` | `CHG-001` |
| Finding | `FND-NNN` | `FND-004` |
| Evidence | `EVD-YYYYMMDD-NNN` | `EVD-20260718-001` |
| Meeting | `MTG-YYYYMMDD-<forum>` | `MTG-20260720-PROGRAM` |
| Gate pack | `GATE-<gate>-YYYYMMDD` | `GATE-G0-20260726` |

IDs are immutable. If an item is cancelled, retain the row and mark it
`Rejected` or `Closed - cancelled`; never recycle the ID.

## Filename convention

Use lowercase ASCII filenames:

```text
<artifact>-<yyyymmdd>-<short-subject>-v<major>.<minor>.<extension>
```

Examples:

- `decision-20260720-operating-model-v1.0.pdf`
- `test-20260814-api36-regression-v1.0.md`
- `gate-g0-20260726-v1.0.md`
- `vendor-20260807-transfer-register-v1.0.xlsx`

Do not place names, phone numbers, email addresses, tokens, case identifiers,
or other personal/sensitive data in filenames.

## Required metadata

Every evidence artifact must identify:

- evidence ID and related requirement, risk, issue, change, finding, or gate;
- owner and reviewer;
- creation date, review date, and version;
- scope, environment, release/build/version, and data classification;
- source system or command;
- expected result and actual result;
- exceptions, limitations, and unresolved dependencies;
- approval decision and approver;
- retention category and restricted-vault reference when applicable.

## Evidence quality rules

1. Prefer exported reports, signed decisions, console records, test output, and
   immutable hashes over screenshots.
2. A screenshot must show date, scope, and relevant configuration, be redacted,
   and have a source-system reference.
3. Test evidence states the command, commit or build, environment, pass/fail,
   and excluded coverage.
4. Legal or regulatory conclusions require the actual qualified adviser or
   authority record in the restricted vault; a roadmap statement is not proof.
5. Production configuration evidence must not reveal secret values.
6. Personal data is masked or synthesized. Real production data is not copied
   into a repository, ticket, chat, development, or test artifact.
7. An evidence reviewer must be independent enough to challenge the submitter.
8. Failed or superseded evidence remains traceable to the replacement.

## Review workflow

1. Owner creates the artifact and links its requirement ID.
2. Owner marks the item `Ready for evidence review`.
3. Reviewer checks authenticity, scope, data handling, result, and limitations.
4. Reviewer records `Accepted`, `Rejected`, or `Accepted with conditions`.
5. The register and gate checklist are updated; rejected evidence does not
   satisfy the requirement.
6. Material evidence changes increment the version and preserve history.

## Gate evidence pack

Each gate pack contains:

- gate criteria and result;
- release/environment scope;
- requirement traceability extract;
- open risk, issue, and finding extract;
- decisions and approved exceptions;
- mandatory test and control evidence;
- rollback or next-phase constraints;
- dated approvals and conditions.

The program lead owns pack assembly. The gate owner owns the decision.

## Retention and disposal

Final retention periods remain subject to the approved records schedule,
Egyptian counsel, the DPO, consumer/tax obligations, litigation hold, and any
applicable Law 175/2018 record categories. Until that schedule is approved:

- do not delete gate, legal, privacy, security, payment, tax, consent, incident,
  complaint, or authority-request evidence;
- do not interpret the potential 180-day cybercrime record requirement as a
  rule to retain all product data or logs;
- apply legal hold before scheduled deletion when authorized;
- record disposal evidence without preserving the disposed personal data.
