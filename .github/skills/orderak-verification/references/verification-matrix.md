# Verification matrix

| Change area | Required group | Additional focused check |
| --- | --- | --- |
| Backend TypeScript or tests | `backend` | Relevant Vitest file or `-t` test name |
| D1 migration | `backend` | Migration-specific test and docs generator |
| Architecture/trust boundary | `architecture` and affected code group | Inspect both architecture documents |
| Android Kotlin or Compose | `android` | Relevant Gradle test class |
| Authentication | `auth` plus affected code group | Auth regression tests |
| Localization or user-visible strings | `localization` plus `android` | Inspect all supported locale resources |
| Documentation only | `architecture` only if architecture map changed | MkDocs/link checks when available |

A protected contract failure is a blocker. Restore the protected behavior or
obtain explicit approval for an intentional migration; never weaken the guard.
