// True when the app is built as a static GitHub Pages demo (no backend).
// In this mode every WebSocket / live connection must be skipped, otherwise
// the browser logs failed connection errors to a server that doesn't exist.
export const IS_DEMO = (import.meta.env.VITE_DEMO_MODE as string) === "true";
