import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const BACKEND_PORT = 37291

const api = {
  // Absolute base URL for the embedded backend (http://localhost:PORT).
  // The frontend tRPC client reads this to build API and WebSocket URLs.
  backendBase: `http://localhost:${BACKEND_PORT}`,
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('get-system-info'),
  setupComplete: (): void => ipcRenderer.send('setup-complete'),
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
  }
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

export interface SystemInfo {
  cpu: string
  cores: number
  ram: number
  gpu: string
  vram: number
  isLegacy: boolean
  zramEnabled: boolean
  zramSize: number
}
