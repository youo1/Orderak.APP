---
name: orderak-verification
description: Select and run the correct Orderak backend, Android, authentication, localization, and architecture verification commands. Use before completing code changes or when diagnosing CI failures.
---

# Orderak verification workflow

1. Read the Repository and Verification sections of the shared
   [learned guidance](../orderak-agent-improvement/references/learned-guidance.md),
   then determine which areas changed from the diff and the task. Learned
   guidance never overrides protected verification contracts.
2. Run the narrowest focused test available before a broad group.
3. Run the required protected-contract task for every auth or localization
   change. Never bypass a failing guard.
4. Run backend type checking for TypeScript changes and architecture
   verification for component/trust-boundary changes.
5. Report the exact commands, pass/fail status, and skipped checks with reasons.

Run a repeatable group from the repository root:

```powershell
node .github/skills/orderak-verification/scripts/verify.mjs backend
node .github/skills/orderak-verification/scripts/verify.mjs android
node .github/skills/orderak-verification/scripts/verify.mjs auth
node .github/skills/orderak-verification/scripts/verify.mjs localization
node .github/skills/orderak-verification/scripts/verify.mjs architecture
node .github/skills/orderak-verification/scripts/verify.mjs all
```

Consult the [verification matrix](./references/verification-matrix.md) to choose
the required group. The script stops on the first failure so the original error
remains visible.
