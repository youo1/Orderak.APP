---
status: archived
generated: false
owner: security
last_verified: 2026-08-19
applies_to: [production, staging]
---
# Credential consolidation — twelve tokens to eight

The target state and the order that reaches it without breaking anything. Every
row below was derived by reading the workflows and querying the live
environments, not from recollection.

## Target state

### Cloudflare — eight tokens

| # | Token | Permissions |
| --- | --- | --- |
| 1 | `orderak-deploy-staging` | Account: Workers Scripts `Edit`, D1 `Edit`, Queues `Edit`, R2 `Edit` · Zone: Workers Routes `Edit`, Zone `Read` |
| 2 | `orderak-deploy-production` | same |
| 3 | `orderak-backup-staging` | Account: D1 `Edit`, R2 `Edit` |
| 4 | `orderak-backup-production` | Account: D1 `Edit`, R2 `Edit` |
| 5 | `orderak-drift-check` | Account: D1 `Read`, Workers Scripts `Read`, Queues `Read`, R2 `Read` |
| 6 | `orderak-analytics` | Account: Account Analytics `Read` |
| 7 | `orderak-restore-read` | Account: R2 `Read`, D1 `Edit` |
| 8 | `orderak-rollback-breakglass` | Account: Workers Scripts `Edit` — offline only |

### GitHub — `Orderak.APP`

| Environment | Secrets | From |
| --- | --- | --- |
| `staging` | `ORDERAK_DEPLOY_STAGING` | 1 |
| | `ORDERAK_BACKUP_STAGING` | 3 |
| | `FIREBASE_APP_DISTRIBUTION_CREDENTIALS`, `FIREBASE_STAGING_GOOGLE_SERVICES_JSON` | — |
| `production` | `ORDERAK_DEPLOY_PRODUCTION` | 2 |
| | `ORDERAK_BACKUP_PRODUCTION` | 4 |
| | `ORDERAK_DRIFT_CHECK` | 5 |
| | `ORDERAK_ANALYTICS` | 6 |
| `backup-restore-*` | `AGE_IDENTITY` (new), `ORDERAK_RESTORE_READ` | 7 |
| `staging-contract-tests` | `CONTRACT_SELLER_PHONE`, `CONTRACT_SELLER_SECRET` | — |

Variables: `CLOUDFLARE_ACCOUNT_ID` everywhere; `AGE_RECIPIENT` and
`DEPLOY_OWNER` on `staging` and `production`;
`FIREBASE_APP_DISTRIBUTION_GROUPS` on `staging`.

Secret names here follow the Cloudflare token they carry, so the mapping is
readable from the name alone. The value is still read into the
`CLOUDFLARE_API_TOKEN` environment variable in every workflow — see the
[token inventory](./cloudflare-token-inventory.md#the-secret-name-and-the-environment-variable-are-not-the-same-string).

## Order

Each step leaves the system working. Nothing is deleted before its replacement
is proven.

1. **Fix permissions** on tokens 1-7. Editing a token's permissions does not
   change its value, so nothing needs re-entering in GitHub.
   - `orderak-backup-production`: D1 `Read` → **`Edit`**. This is the failure
     that stopped the production backup — `d1 export` creates a job.
   - Confirm 1 and 2 carry the Zone rows. Missing them is what stopped the
     first production deploy.
2. **Create token 6**, `orderak-analytics`.
3. **Wire `Orderak.APP`**: re-set every secret from its named token, add the
   Firebase pair, create `staging-contract-tests`. After this, `Orderak.APP`
   provably uses only the eight — known by construction, not inference, which
   is the point.
4. **Prove it**: production backup, then a drill against it. That closes the
   last open link — the production age pair has a new recipient and identity
   configured but has never been exercised.
5. **Delete the five duplicates**: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_D1_BACKUP_TOKEN`, `CLOUDFLARE_DRIFT_CHECK_TOKEN`,
   `CLOUDFLARE_ANALYTICS_TOKEN`, `orderak-restore-read-production`. Confirm no
   workflow still reads the name before removing each one.

Steps 3 and 5 are mostly mechanical and can be done by the assistant, except
for entering any secret value, which cannot.
