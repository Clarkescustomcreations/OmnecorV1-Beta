import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItem, protocol, net } from 'electron'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import { appendFile, readFileSync, writeFileSync, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import os from 'os'
import util from 'util'
import icon from '../../resources/icon.png?asset'

const LOG_FILE = join(
  process.env.APPDATA || process.env.HOME || '.',
  'omnecor-debug.log'
)
function log(msg: string): void {
  appendFile(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, () => { /* ignore write errors */ })
}

log('=== Omnecor main process started ===')
log(`PID: ${process.pid}  platform: ${process.platform}`)
log(`__dirname: ${__dirname}`)
log(`resourcesPath: ${(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath}`)

process.on('uncaughtException', (err: Error) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason: unknown) => {
  log(`UNHANDLED REJECTION: ${String(reason)}`)
})

const execAsync = util.promisify(exec)

let backendProcess: ChildProcess | null = null
let isQuitting = false
// Fixed port for the embedded backend. High port avoids conflicts with `pnpm dev` on 3000.
const BACKEND_PORT = process.env.PORT || 37291

// Register the custom protocol before app is ready (required by Electron).
// app://omnecor/ serves the built frontend from the bundled public directory.
// This avoids loading via http://localhost so dynamic imports resolve via file
// I/O rather than a network fetch that can fail if the backend is slow to start.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,   // enables relative URL resolution (needed for dynamic import())
      secure: true,     // treated as a secure origin (same-origin fetch, WebCrypto, etc.)
      supportFetchAPI: true,
      corsEnabled: true,
    }
  }
])

/**
 * Only allow opening external URLs with safe schemes. Restricting to https/mailto
 * neutralises the real `shell.openExternal` threat: launching arbitrary protocol
 * handlers (file:, smb:, custom app: schemes) that can execute code or exfiltrate
 * data. A host allowlist can be layered on top later if desired.
 */
function isSafeExternalUrl(urlString: string): boolean {
  try {
    const { protocol } = new URL(urlString)
    return protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/**
 * Returns a stable JWT signing secret for the embedded backend, persisted in the
 * app's userData directory. A random secret regenerated on every launch would
 * invalidate the session cookie each restart, logging the user out constantly.
 */
function getPersistentJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  const secretPath = join(app.getPath('userData'), 'jwt-secret')
  try {
    if (existsSync(secretPath)) {
      const existing = readFileSync(secretPath, 'utf8').trim()
      if (existing) return existing
    }
  } catch (err) {
    log(`Failed to read persisted JWT secret: ${String(err)}`)
  }
  const secret = randomBytes(32).toString('hex')
  try {
    writeFileSync(secretPath, secret, { mode: 0o600 })
    log(`Generated and persisted new JWT secret at ${secretPath}`)
  } catch (err) {
    log(`Failed to persist JWT secret (sessions will reset on restart): ${String(err)}`)
  }
  return secret
}

function startBackend(): void {
  log('startBackend called')
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

  // Use Electron's own Node.js runtime (ELECTRON_RUN_AS_NODE) in production so
  // native modules compiled by electron-builder (better-sqlite3, onnxruntime-node)
  // match the ABI. System `node` has a different NODE_MODULE_VERSION.
  const nodeExec = is.dev ? 'node' : process.execPath

  log(`backend path: ${backendPath}`)
  log(`backend args: ${JSON.stringify(args)}`)
  log(`backend cwd: ${cwd}`)
  log(`node exec: ${nodeExec}`)
  backendProcess = spawn(nodeExec, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: is.dev ? 'development' : 'production',
      PORT: String(BACKEND_PORT),
      JWT_SECRET: getPersistentJwtSecret(),
      // NOTE: ZERO_LOGIN_MODE must NOT be set here. The desktop app uses real
      // authentication (Google / Microsoft OAuth or a local account) via the
      // setup wizard. In production, env.ts throws if ZERO_LOGIN_MODE=true.
      OMNECOR_DB: 'sqlite',
      ...(is.dev ? {} : { ELECTRON_RUN_AS_NODE: '1' })
    },
    stdio: 'pipe'
  })

  backendProcess.stdout?.on('data', (data) => { log(`[Backend]: ${data}`); console.log(`[Backend]: ${data}`) })
  backendProcess.stderr?.on('data', (data) => { log(`[Backend Error]: ${data}`); console.error(`[Backend Error]: ${data}`) })

  backendProcess.on('close', (code) => {
    log(`Backend process exited with code ${code}`)
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
    title: 'Omnecor HMCI Workstation',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Secure baseline (Electron security checklist): sandboxed renderer,
      // isolated context, no Node in the renderer, same-origin policy enforced.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // window.open / target=_blank: never open a sub-window; hand safe URLs to the
  // OS browser and drop everything else.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      shell.openExternal(details.url)
    } else {
      log(`Blocked window.open to unsafe URL: ${details.url}`)
    }
    return { action: 'deny' }
  })

  // Block navigation away from the app's own origin. The window only ever
  // legitimately shows app://omnecor/ (production) or the dev renderer URL.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed =
      url.startsWith('app://omnecor/') ||
      (!!devUrl && url.startsWith(devUrl))
    if (!allowed) {
      event.preventDefault()
      log(`Blocked navigation to: ${url}`)
      if (isSafeExternalUrl(url)) shell.openExternal(url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Load the production frontend via the custom app:// protocol.
    // This gives dynamic import() a real origin so relative chunk URLs
    // resolve correctly without fetching from localhost.
    mainWindow.loadURL('app://omnecor/')
  }
}

app.whenReady().then(async () => {
  log('app.whenReady fired')
  electronApp.setAppUserModelId('com.omnecor.workstation')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

    window.webContents.on('context-menu', (_event, params) => {
      const menu = new Menu()
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Undo', role: 'undo' }))
        menu.append(new MenuItem({ label: 'Redo', role: 'redo' }))
        menu.append(new MenuItem({ type: 'separator' }))
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }))
        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
        menu.append(new MenuItem({ type: 'separator' }))
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }))
      } else if (params.selectionText && params.selectionText.trim() !== '') {
        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
      } else {
        return
      }
      menu.popup({ window })
    })
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
        try {
          const { stdout } = await execAsync(
            'powershell -Command "Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM | Format-List"'
          )
          const nameMatch = stdout.match(/Name\s*:\s*(.*)/)
          const ramMatch = stdout.match(/AdapterRAM\s*:\s*(.*)/)
          if (nameMatch) info.gpu = nameMatch[1].trim()
          if (ramMatch) info.vram = Math.round(parseInt(ramMatch[1]) / (1024 * 1024))
        } catch {
          // Fall back to wmic if PowerShell unavailable
          try {
            const { stdout } = await execAsync(
              'wmic path win32_VideoController get name,AdapterRAM /format:list'
            )
            const nameMatch = stdout.match(/Name=(.*)/)
            const ramMatch = stdout.match(/AdapterRAM=(.*)/)
            if (nameMatch) info.gpu = nameMatch[1].trim()
            if (ramMatch) info.vram = Math.round(parseInt(ramMatch[1]) / (1024 * 1024))
          } catch {
            info.gpu = 'GPU detection unavailable on Windows'
          }
        }
      } else if (process.platform === 'darwin') {
        try {
          const { stdout } = await execAsync('system_profiler SPDisplaysDataType | grep -E "Chipset|VRAM"')
          info.gpu = stdout.trim() || 'Apple GPU'
        } catch {
          info.gpu = 'GPU detection unavailable on macOS'
        }
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

  // Serve the built frontend via app://omnecor/ using net.createURLLoader.
  // All asset requests (JS chunks, CSS, fonts, images) are handled here —
  // nothing is fetched from localhost, so dynamic import() always resolves.
  const publicDir = join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'public')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    // Strip the host (omnecor) and leading slash, default to index.html
    let relPath = url.pathname.replace(/^\//, '') || 'index.html'
    // SPA fallback: paths without a file extension serve index.html
    if (!extname(relPath)) relPath = 'index.html'
    return net.fetch(`file://${join(publicDir, relPath)}`)
  })

  // --- IPC: open external URL (validated — defence in depth with preload) ---
  ipcMain.on('open-external', (_, url: string) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    } else {
      log(`Rejected unsafe external URL from renderer: ${url}`)
    }
  })

  startBackend()
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
