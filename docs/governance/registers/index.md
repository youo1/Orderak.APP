# Governance register index

These registers are live control records. Update the narrowest register in the
same change as the decision, risk, issue, implementation, policy, vendor,
permission, or finding it describes.

## Active registers

| Register | Purpose | Accountable owner | Review frequency |
| --- | --- | --- | --- |
| [Requirements register](./requirements-register.md) | Requirements, assumptions, open questions, protected contracts | Product owner | Weekly and at scope change |
| [Decision log](./decision-log.md) | Material decisions, alternatives, authority, and consequences | Program lead | Weekly and at decision |
| [Risk register](./risk-register.md) | Uncertainty, exposure, treatment, residual risk, and escalation | Executive risk owner | Weekly; Critical/High immediately |
| [Issue and change log](./issue-and-change-log.md) | Present blockers and controlled change requests | Program lead | Daily while active |
| [Third-party and permission register](./third-party-and-permission-register.md) | Vendors, SDKs, processors, permissions, and package visibility | CTO with privacy/security | Fortnightly and before release |
| [Policy version register](./policy-version-register.md) | Public/legal/architecture policy versions and acceptance mapping | Counsel / privacy lead | At every policy or behavior change |
| [Findings register](./findings-register.md) | Test, audit, privacy, security, resilience, and evidence gaps | QA / release lead | Weekly; Critical/High immediately |

## Register rules

1. Use immutable IDs from the [evidence standard](../evidence-standard.md).
2. One accountable owner and one next action are mandatory for every open row.
3. Use ISO dates (`YYYY-MM-DD`) and explicit gate references.
4. Link evidence; do not paste secrets, personal data, or restricted records.
5. Closing an item requires the closer, date, decision, and accepted evidence.
6. A risk and an issue may be related, but they are not interchangeable: a risk
   is uncertain; an issue already exists.
7. A finding is not closed because a code change exists; independent retest or
   evidence review is required.
8. Superseded rows remain visible and point to the replacement.

## Review checklist

- Are any IDs duplicated, missing, or recycled?
- Does every open row have an owner, due date, status, and next action?
- Do Critical/High items have immediate escalation and gate impact?
- Do changes link requirements, risks, tests, rollback, and approvals?
- Do vendor/SDK/permission changes reconcile with privacy notices and Play Data Safety?
- Do policy versions match production behavior and stored acceptance evidence?
- Does the current gate pack contain every mandatory item?
