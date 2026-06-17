import { ElectronAPI } from '@electron-toolkit/preload'

export interface OmnecorAPI {
  /** Absolute base URL for the embedded backend (http://localhost:PORT). */
  backendBase: string
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OmnecorAPI
  }
}
