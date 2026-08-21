---
status: current
generated: false
owner: legal
applies_to: [production]
---
# Legal-document status

The files in this directory are repository copies of the Terms and Privacy
content. They are not evidence of final legal approval.

## Current review state

- The 29 July 2026 repository versions disclose Passkeys, the absence of
  biometric collection, required private birth year, optional private email,
  short-lived onboarding/security records, their account-deletion treatment,
  and the pinned ODbL city catalogue. Migration
  `038_publish_static_city_legal_v4.sql` is generated from these files for the
  owner-approved provider replacement; independent Egyptian legal review is
  still recommended.
- English and Arabic versions require clause-level parity review.
- The public visibility of seller contact and payout details must be reconciled
  with the product, API, and data map.
- The privacy disclosure for DeepSeek must cover automatic product translation
  as well as the deferred seller AI assistant before that processing is enabled.
- Legal bases, retention periods, cross-border transfer requirements, operator
  identity, and regulatory citations require review by qualified Egyptian
  counsel.

Do not publish a new legal version or change the consent/acceptance behavior
from these files alone. A legal-content change must be approved, versioned, and
published through the legal-version workflow described in the
[production authentication plan](../product/production-auth-plan.md).
