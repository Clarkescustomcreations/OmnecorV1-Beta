import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
