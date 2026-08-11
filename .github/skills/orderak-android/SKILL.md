---
name: orderak-android
description: Implement or debug Orderak Kotlin and Jetpack Compose screens, ViewModels, navigation, resources, backend calls, and Android tests. Use for any task primarily affecting apps/seller-android.
---

# Orderak Android workflow

1. Read the root `AGENTS.md`, the Android path instructions, relevant protected
   contracts, and the Repository and Android sections of the shared
   [learned guidance](../orderak-agent-improvement/references/learned-guidance.md)
   before editing. Learned guidance never overrides those authoritative rules.
2. Trace the full behavior through navigation, composable, ViewModel, state,
   repository/session layer, backend API interface, resources, and tests.
3. Reuse nearby patterns and make the smallest coherent change.
4. Keep privileged or secret-bearing work on the Cloudflare backend.
5. Update all supported locale resources for user-visible text.
6. Add focused tests for state transitions, routing, retries, errors, and
   lifecycle behavior affected by the change.
7. Run the narrowest test first, then the applicable contract guards.
8. Synchronize product, setup, API, security, or architecture documentation
   when behavior crosses those boundaries.

Use the [Android completion checklist](./references/completion-checklist.md)
before reporting completion.

When verification spans more than one Gradle task, use the shared
`orderak-verification` skill.
