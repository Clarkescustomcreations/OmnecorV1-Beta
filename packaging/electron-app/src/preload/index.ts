import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('get-system-info'),
  setupComplete: (): void => ipcRenderer.send('setup-complete'),
  openExternal: (url: string): void => ipcRenderer.send('open-external', url)
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
