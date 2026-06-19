# Memory — Export Default Debt Sweep & named Exports Refactoring

Last updated: 2026-06-19T15:10:00-03:00

## What was built

- **Mass Named Exports Sweep:** Rewrote all 77 files containing default exports (React page files, components, and tRPC routers) to named exports in compliance with `AGENTS.md` and `Code-Standards.md` rules.
- **Import Statements Refactoring:** Updated static import statements, brace-destructuring, and dynamic lazy-load wrapper calls (`lazy(() => import(...).then(m => ({ default: m.Component })))`) across 19 files (including `App.tsx` and `main.tsx`).
- **Unused default exports deletion:** Cleaned up unused default exports (such as in `ommesh.router.ts`) that were already being imported as named exports elsewhere.

## Decisions made

- **Regex-Safe Import Parsing:** Configured the import pattern regex to prevent matching across side-effect imports (like `import 'style.css'` followed by a blank space and a component import) by enforcing negative lookahead boundary checks on the `import` keyword (`(?:(?!import)[\s\S])+?`).
- **Safe Named Memo Wrappers:** Wrapped default-exported `memo(Component)` exports (specifically in `FileNode.tsx`) inside named `memo` variable exports without needing manual bracket matches.

## Problems solved

- **FileNode import compilation error (TS2613):** Fixed a tsc build block in `NeuralWorkspaceCanvas.tsx` by correctly rewriting the default `FileNode` import to the new named import syntax.
- **Import matching skips:** Resolved issues where certain imports were skipped due to side-effect imports (like style sheets) confusing the parser.

## Current state

- **Verification Status:** `pnpm check` typecheck passes with 0 errors.
- **Test Suite:** `pnpm test` runs and passes with 353/353 green tests.
- **Git status:** Clean, consistent named exports across all 77 components/routers.

## Next session starts with

- Physical device sideloading and always-listening wake word testing (F27 Android leg).
- Network-level OMMESH testing with mobile nodes.

## Open questions

- None.
