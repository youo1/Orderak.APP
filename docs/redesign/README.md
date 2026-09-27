---
status: draft
generated: false
owner: product
applies_to: [internal]
---
# Orderak redesign pack

The review pack for a full redesign of the Android seller app and the admin
control plane, plus a right-sizing review of the backend that serves them.

> **This paragraph used to say that nothing in the pack had been implemented.**
> That was true when it was written — the pack was produced in a read-only pass,
> and no code, schema, migration, route or generated document was changed to
> produce it. It is no longer true: the programme the pack describes has since
> been executed in part, and a reader who acted on the old sentence would redo
> finished work. **[`handover.md`](./handover.md) is the current state** — what is
> done, what is open, and how to re-verify each part. This paragraph is left in
> place, corrected, rather than quietly rewritten, because a document that
> changes its mind without saying so is how the next reader learns not to trust
> any of it.

## What is in the pack

| File | What it is | Read it when |
| --- | --- | --- |
| [Master execution prompt](./master-redesign-prompt.md) | The complete instruction set for an agent to plan and execute the redesign, including the non-negotiable rules, the phases, the verification matrix, and the definition of done | First, and again at the start of every phase |
| [Handover](./handover.md) | The state of the work as it actually stands, what is done, how to re-verify each part, and where the next round should start | Before changing anything — it is written from the working tree, not from memory |
| [Decision log](./redesign-decisions.md) | Every decision the redesign depends on, with its status, its options, and what unblocks it | Before starting any phase; a phase may not start on an undecided dependency |
| [الملخص التنفيذي](./executive-summary.ar.md) | The same pack explained in Arabic for the product owner | When reviewing rather than executing |
| [Backend inventory and necessity review](./recon/backend-inventory.md) | Every backend capability with a keep, simplify, fix, defer, or delete verdict, with evidence and a cost ledger | Phase 5, and whenever a change touches the backend |
| [Android UI audit](./recon/android-ui-audit.md) | Every screen, state, component, and token in the seller app, with the concrete UX and consistency defects found and the contracts that constrain the rebuild | Phase 2 and Phase 3 |
| [Admin panel audit](./recon/admin-panel-audit.md) | Every admin route and section, its backend coupling, and the UX and architecture defects found | Phase 4 |
| [Open-source evaluation](./recon/open-source-evaluation.md) | Candidate tools and libraries with licences, verdicts, a recommended shortlist, and the licence and Workers-compatibility traps to avoid | Phase 1, before adding any dependency |

## How to use it

1. Read the master prompt in full. It is the only document that has to be read
   end to end.
2. Read the decision log and confirm or correct the proposed decisions.
3. Run Phase 0 to re-verify the baselines the recon reports established.
4. Do not begin Phase 2 before the Phase 1 gate is signed off.
5. Treat the recon reports as findings, not as instructions. They are evidence
   gathered in a read-only pass and are marked unverified wherever a claim could
   not be confirmed from source.

## Summary of what the review found

The four headline conclusions, each with its evidence in the report named
beside it:

1. **The two interfaces are the problem, not the platform.** The backend serves
   a coherent product; the Android app has failure states that cannot be
   retried and irreversible actions without confirmation, and the admin panel
   grew by accretion to 41 sections. Neither is a rewrite candidate.
   ([Android audit](./recon/android-ui-audit.md), [admin audit](./recon/admin-panel-audit.md))
2. **A large part of the backend's admin surface is internal project tooling
   rather than product operation.** It also carries a live runtime dependency,
   so the removal is a sequencing problem as much as a size problem.
   ([Backend review](./recon/backend-inventory.md))
3. **The design system is stronger than the interfaces that use it.** Tokens,
   contrast validation, and semantics are in good shape; adoption is uneven,
   several token groups do not exist, and the runtime Theme Builder has no
   delivery path to the device.
   ([Android audit](./recon/android-ui-audit.md))
4. **Almost nothing needs to be adopted.** Roughly half of the recommended
   shortlist is already in the repository; the wins are component reuse and
   deleting glue. The expensive mistake to avoid is a tool that brings its own
   database, which would create a second data authority beside D1.
   ([Open-source evaluation](./recon/open-source-evaluation.md))

## What this pack does not do

- It does not change any contract, guard, migration, route, or screen.
- It does not execute any deletion. The backend review proposes them; the owner
  approves them; a separate change implements them.
- It does not approve a visual direction. That is the Phase 1 gate.
- It does not answer every question. The decision log lists what is open and
  what closes it.

## Status and authority

| | |
| --- | --- |
| Status | The documents are draft proposals and none is ratified. Part of what they propose has since been implemented — see [`handover.md`](./handover.md) — and the two decisions below are still the owner's to make |
| Authority | None. These documents propose; the versioned contracts, the decision records, and the owner decide |
| Applies to | Internal only |

## Where the success criteria stand

The criteria are G1–G7 in [`master-redesign-prompt.md`](./master-redesign-prompt.md)
§5. A criterion reads as met here only when something measured it, because the
point of writing them down was to stop the redesign being judged by impression.

| | Criterion | State |
| --- | --- | --- |
| G1 | A new seller reaches first value faster | **Not met.** Measured at 9 taps and 11 required fields, unchanged from before, because the six files that decide the path carry zero structural changes. One wasted tap was removed: `canContinueAccount` was written for step 1's button and had no reader anywhere in the app. Full trace in [`measurements/g1-first-value.md`](./measurements/g1-first-value.md) |
| G2 | The app answers "what needs me now" without navigation | Partly. اليوم carries the counters, the sync state and the plan meter at first paint; not re-taken since |
| G3 | One visual language across all three surfaces | Partly. Android and the panel resolve spacing, radius, type size and weight to tokens with every ceiling at zero; the panel's hand-written colour exceptions are not counted |
| G4 | The admin panel becomes navigable | **Met.** 42 sections in 7 groups, each **one** navigation from `/`; the shell's registry and `contracts/typescript/admin.ts` now agree, having drifted by two sections and ten groups; the tree is documented per branch in [`information-architecture.md`](../admin/information-architecture.md), generated and guarded against going stale |
| G5 | Operators can act safely and quickly | Partly. Every destructive path goes through one confirmation and one step-up rule; progress and truthful terminal states for long-running operations are unverified |
| G6 | The backend is explainable | Partly. Every capability has a verdict in the backend inventory; the deletions are proposed with a migration and are not executed |
| G7 | Nothing protected broke | **Met so far.** Every contract guard, repository guard and screenshot baseline is green at the current tree |
