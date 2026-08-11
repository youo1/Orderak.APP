# Orderak learned guidance

This file contains stable, evidence-backed guidance learned while working in
this repository. It supplements, but never overrides, `AGENTS.md`, protected
contracts, path instructions, or security requirements.

Entries are added only by the deterministic learning recorder. Each entry must
cite repository evidence and remain concise, reusable, and free of secrets.

## Repository

<!-- learning:repository -->

## Android

<!-- learning:android -->

- Guard long-running auth operations with a single in-flight controller and generation checks before state writes to prevent stale callbacks from overwriting newer UI state. Evidence: `apps/seller-android/app/src/main/java/app/orderak/seller/feature/auth/AuthOperationController.kt:8`, `apps/seller-android/app/src/main/java/app/orderak/seller/feature/auth/AuthViewModel.kt:73`, `apps/seller-android/app/src/main/java/app/orderak/seller/feature/auth/AuthViewModel.kt:398`.

## Backend

<!-- learning:backend -->

## Admin frontend

<!-- learning:admin-web -->

## Documentation

<!-- learning:documentation -->

## Verification

<!-- learning:verification -->
