# Omnecor Memory
Last Updated: 2026-06-24

## What was built
- Completed functional cleanup of LiteRT-LM Swapping UI Labels. Updated comments and user-facing strings in `model-download.ts` and `settings.tsx` in the Android workspace (`packaging/android/omnecor-hq`) to consistently use `.litertlm` and `"LiteRT-LM"` instead of the deprecated `.task` / `"MediaPipe"` naming.
- Verified both root and mobile workspaces types via `pnpm check`.
- Verified all 406 test cases pass successfully.

## Decisions made
- Retained support for legacy `.task` file loading for backwards compatibility while updating user-facing descriptions to LiteRT-LM.

## Problems solved
- Standardized AI engine terms in mobile views to avoid user confusion between MediaPipe and LiteRT-LM.

## Current state
- LiteRT-LM labeling cleanups complete.
- `pnpm check` and `pnpm test` verified clean across workspaces.

## Next session starts with
- Continue with remaining environmental/hardware verification gates on physical devices (NSIS installer run on Windows PC, wake-word testing on Android, etc.).

## Open questions
- None.
