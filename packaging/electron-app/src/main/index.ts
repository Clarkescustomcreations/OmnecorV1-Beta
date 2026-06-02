import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import os from 'os'
import util from 'util'
import icon from '../../resources/icon.png?asset'

const execAsync = util.promisify(exec)

let backendProcess: ChildProcess | null = null
let isQuitting = false
const BACKEND_PORT = process.env.PORT || 3000

function startBackend(): void {
  console.log('Starting Omnecor backend...')

  // In development: backend lives in the sibling project directory.
  // In production: backend is compiled to dist/index.js and unpacked from asar.
  const backendPath = is.dev
    ? join(__dirname, '../../../../server/_core/index.ts')
    : join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'index.js')

  const args = is.dev ? ['--import', 'tsx', backendPath] : [backendPath]
  const cwd = is.dev
    ? join(__dirname, '../../../..') // project root in dev
    : join(process.resourcesPath, 'app.asar.unpacked', 'backend')

  backendProcess = spawn('node', args, {
    cwd,
    env: { ...process.env, NODE_ENV: is.dev ? 'development' : 'production' },
    stdio: 'pipe'
  })

  backendProcess.stdout?.on('data', (data) => console.log(`[Backend]: ${data}`))
  backendProcess.stderr?.on('data', (data) => console.error(`[Backend Error]: ${data}`))

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`)
    if (code !== 0 && !isQuitting) {
      dialog.showErrorBox(
        'Backend Failure',
        `The Omnecor backend exited unexpectedly with code ${code}.`
      )
    }
  })
}

async function waitForBackend(url: string, timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  return false
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    title: 'Omnecor Setup Wizard',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.omnecor.workstation')

  startBackend()

  // In production wait for the backend to be healthy before showing the wizard
  if (!is.dev) {
    const ready = await waitForBackend(`http://localhost:${BACKEND_PORT}/health`)
    if (!ready) {
      dialog.showErrorBox(
        'Connection Timeout',
        'Could not connect to the Omnecor backend. Please check the logs.'
      )
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // --- IPC: system hardware info for the Setup Wizard ---
  ipcMain.handle('get-system-info', async () => {
    const info = {
      cpu: os.cpus()[0].model,
      cores: os.cpus().length,
      ram: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      gpu: 'Unknown',
      vram: 0,
      isLegacy: false,
      zramEnabled: false,
      zramSize: 0
    }

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'wmic path win32_VideoController get name,AdapterRAM /format:list'
        )
        const nameMatch = stdout.match(/Name=(.*)/)
        const ramMatch = stdout.match(/AdapterRAM=(.*)/)
        if (nameMatch) info.gpu = nameMatch[1].trim()
        if (ramMatch) info.vram = Math.round(parseInt(ramMatch[1]) / (1024 * 1024))
      } else if (process.platform === 'linux') {
        const { stdout } = await execAsync('lspci | grep -i vga')
        info.gpu = stdout.split(':').pop()?.trim() || 'Unknown'
        try {
          const { stdout: nv } = await execAsync(
            'nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits'
          )
          info.vram = parseInt(nv.trim())
        } catch { /* no NVIDIA GPU */ }
        try {
          const { stdout: zr } = await execAsync(
            'zramctl --bytes --noheadings --output SIZE | head -n 1'
          )
          if (zr.trim()) {
            info.zramEnabled = true
            info.zramSize = Math.round(parseInt(zr.trim()) / (1024 * 1024 * 1024))
          }
        } catch { /* no ZRAM */ }
      }
    } catch (e) {
      console.error('GPU/ZRAM detection failed', e)
    }

    // Legacy: < 8 GB RAM, < 4 cores, or integrated Intel GPU with < 12 GB RAM
    if (
      info.ram < 8 ||
      info.cores < 4 ||
      (info.gpu.toLowerCase().includes('intel') && info.ram < 12)
    ) {
      info.isLegacy = true
    }

    return info
  })

  // --- IPC: Setup Wizard finished — load the main app UI ---
  ipcMain.on('setup-complete', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      windows[0].setTitle('Omnecor HMCI Workstation')
      windows[0].loadURL(`http://localhost:${BACKEND_PORT}`)
    }
  })

  // --- IPC: open external URL ---
  ipcMain.on('open-external', (_, url: string) => {
    shell.openExternal(url)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (backendProcess) {
    console.log('Killing backend process...')
    backendProcess.kill()
  }
})
