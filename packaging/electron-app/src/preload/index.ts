import { contextBridge, ipcRenderer } from 'electron'

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox-safe preload.
//
// The BrowserWindow runs with `sandbox: true`, and a sandboxed preload may only
// `require()` the built-in `electron` module plus a few Node builtins — it CANNOT
// load external npm packages. Importing `@electron-toolkit/preload` here would
// therefore throw at runtime, aborting the whole preload before `window.api` is
// exposed and leaving the renderer with "Desktop bridge not ready". So this file
// intentionally depends on `electron` ONLY. The renderer never used
// `window.electron`, so it is not re-exposed.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_PORT = 37291

const api = {
  // Absolute base URL for the embedded backend (http://localhost:PORT).
  // The frontend tRPC client reads this to build API and WebSocket URLs.
  backendBase: `http://localhost:${BACKEND_PORT}`,
  openExternal: (url: string): void => {
    // Validate at the renderer boundary too: only forward safe schemes. The
    // main process re-validates (defence in depth).
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'mailto:') {
        ipcRenderer.send('open-external', url)
      }
    } catch {
      /* invalid URL — ignore */
    }
  },
  // OAuth in Electron requires a dedicated popup window — navigating the main
  // window away from app://omnecor/ loses the React state and the session
  // cookie can't cross origins back to the frontend. This IPC call opens a
  // BrowserWindow, completes the OAuth flow, extracts the session token from
  // the backend cookie, and resolves with { token } so the wizard can store
  // it as a Bearer token in localStorage.
  openOAuthPopup: (url: string): Promise<{ token?: string; error?: string }> =>
    ipcRenderer.invoke('oauth-start', url),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
}

export type DesktopApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    // Surfaced to the renderer console; the wizard shows "Desktop bridge not
    // ready" if window.api is missing.
    console.error('[preload] Failed to expose window.api:', error)
  }
} else {
  ;(window as unknown as { api: DesktopApi }).api = api
}
