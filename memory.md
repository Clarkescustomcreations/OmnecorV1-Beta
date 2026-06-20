# Memory — Always Listening Registry Alignment

Last updated: 2026-06-19T18:02:00-03:00

## What was built

- **UI Registry Update:** Adjusted the "Always Listening" section of [UI-Registry.md](file:///home/linux/Documents/OmnecorV1-Beta/Context/UI-Registry.md).
  - Updated "Enable Always Listening" notes to specify "local NPU Whisper wake-word loop" instead of "Porcupine wake".
  - Updated "Test a voice turn" notes to specify "whisper.rn native libs" instead of "whisper.rn/Porcupine libs".
  - Kept the `🟡 PARTIAL` status since both features require native audio/NPU assets inside the compiled APK.

## Decisions made

- Aligned the system architecture registry with the actual codebase implementation where Picovoice/Porcupine was replaced by a local custom sliding-window wake-word recording loop running via `whisper.rn` on the NPU.

## Problems solved

- Resolved stale references to Porcupine and Picovoice in `Context/UI-Registry.md`.

## Current state

- **Verification Status:** `pnpm check` typecheck passes with 0 errors.
- **Test Suite:** `pnpm test` runs and passes with 353/353 green tests.

## Next session starts with

- Network-level OMMESH testing with mobile nodes.
- Physical device testing of the APK package.

## Open questions

- None.
