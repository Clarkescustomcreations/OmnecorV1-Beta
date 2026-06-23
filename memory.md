# Omnecor Memory
Last Updated: 2026-06-23

## What was built
- Completed visual verification and sweeping replacement of improperly mapped Tailwind design tokens. Specifically, `text-accent`, `bg-accent`, `border-accent`, and `ring-accent` were reverted to `primary` semantic variants across 46 components and pages.
- Fixed severe light-mode invisibility issues for the Dashboard icons and UI elements.
- Fixed a long-standing CSS bug causing the Chat Sandbox Terminal to render completely offscreen.

## Decisions made
- Kept the `--accent` definition as a light grey (`oklch(0.967 0.001 286.375)`) in Light mode to preserve the default Shadcn UI subtle hover states in standard components (Dropdowns, Command Palette).
- Fixed the disappearing terminal pop-up by hard-anchoring the `FloatingWindow.tsx` root div to `top-0 left-0`. This gives Framer Motion a static `(0,0)` origin, translating its layout correctly relative to the viewport top-left rather than displacing the terminal deeply beneath the browser baseline.

## Problems solved
- `FloatingWindow` translation displacements (off-screen terminals) were resolved. 
- "Invisible blue" components in light mode successfully migrated to `*-primary` adapting elegantly in both light (`#1d4ed8`) and dark (`#3b82f6`) modes.
- Avoided mutating core Shadcn UI elements by running an exclusion filter during the accent-to-primary migration pass.

## Current state
- The 774-token design-token backlog pass is 100% complete and visually verified.
- The task is marked complete in `Context/Progress-Tracker.md`.
- `pnpm check` and `pnpm test` successfully verify 0 TypeScript errors and 371/371 passing tests.

## Next session starts with
- Work on Phase 5 features according to the Build Plan.

## Open questions
- None.
