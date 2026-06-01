import { ElectronAPI } from '@electron-toolkit/preload'

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

export interface OmnecorAPI {
  getSystemInfo: () => Promise<SystemInfo>
  setupComplete: () => void
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OmnecorAPI
  }
}
