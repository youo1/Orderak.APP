# Android completion checklist

- UI state survives recomposition and expected lifecycle changes.
- Navigation cannot enter an unauthorized or invalid state.
- Loading, empty, success, and error states are intentional.
- User-visible strings exist in default, Arabic, English, and French resources.
- Layout remains usable with long and right-to-left text.
- No secret, provider SDK, administrative API, or privileged credential was
  added to Android.
- New backend behavior is represented in the Android API abstraction rather
  than called ad hoc from UI code.
- Focused tests cover changed state and failure behavior.
- `verifyAuthPhase1Contract` ran after authentication edits.
- `verifyLocalizationContract` ran after localization edits.
- Required product and architecture documentation is synchronized.
