import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItem, protocol, net, session } from 'electron'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import { appendFile, readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync, execFileSync, spawn, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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
  // EPIPE is expected when stdout/stderr pipe readers close (e.g. `... | tee log`).
  // It is not a fatal error — swallow it so the app doesn't crash on pipe close.
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
  process.exit(1)
})
process.on('unhandledRejection', (reason: unknown) => {
  log(`UNHANDLED REJECTION: ${String(reason)}`)
})

let backendProcess: ChildProcess | null = null
let isQuitting = false
// Fixed port for the embedded backend. High port avoids conflicts with `pnpm dev` on 3000.
const BACKEND_PORT = process.env.PORT || 37291

// Kill any stale process occupying our port so we always start on the expected port.
// A previous crash or unclean shutdown can leave the backend running as an orphan.
function freePortIfBusy(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `netstat -aon | findstr ":${port} " | findstr LISTENING`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim()
      const pid = out.split(/\s+/).pop()
      // Validate the PID is numeric (and not the system idle pid) before passing it
      // to taskkill via an arg array — never via a shell-interpolated string (F2).
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        execFileSync('taskkill', ['/F', '/PID', pid], { timeout: 5000 })
        log(`Freed port ${port}: killed stale PID ${pid} (Windows)`)
      }
    } else {
      // Try three methods in order: fuser → lsof → ss (one will be available on any Linux distro)
      let freed = false
      const methods = [
        `fuser -k ${port}/tcp 2>/dev/null`,
        `lsof -ti :${port} 2>/dev/null | xargs -r kill -9`,
        `ss -lptn 'sport = :${port}' 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | xargs -r kill -9`,
      ]
      for (const cmd of methods) {
        try {
          execSync(cmd, { timeout: 5000 })
          log(`Freed port ${port} via: ${cmd.split(' ')[0]}`)
          freed = true
          break
        } catch { /* try next method */ }
      }
      if (!freed) log(`freePortIfBusy: no method could kill pid on port ${port} — continuing anyway`)
    }
  } catch {
    // Port was already free or the kill raced — proceed
  }
}

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

// A random nonce generated once per launch. The backend echoes it back in
// /health so we can verify we're talking to OUR instance, not a stale process
// left over from a crashed previous session that still occupies the port.
const BACKEND_NONCE = randomBytes(8).toString('hex')

// Poll the backend /health endpoint until it responds OK and echoes the
// correct nonce (or we time out). The nonce check prevents a false-positive
// where a stale previous instance is still alive on port 37291 — its /health
// returns 200 but its nonce won't match, so we keep waiting.
async function waitForBackend(port: number, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const healthUrl = `http://localhost:${port}/health`
  log(`Waiting for backend at ${healthUrl} (nonce: ${BACKEND_NONCE})…`)
  while (Date.now() < deadline) {
    try {
      const r = await net.fetch(healthUrl)
      if (r.ok) {
        const body = await r.json() as { nonce?: string }
        if (body.nonce === BACKEND_NONCE) {
          log('Backend health check passed (nonce verified)')
          return true
        }
        log(`Health OK but wrong nonce (got ${body.nonce ?? 'none'}) — stale process on port, retrying…`)
      }
    } catch { /* not ready yet */ }
    await new Promise(res => setTimeout(res, 600))
  }
  log('Backend health check timed out')
  return false
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

  // Use Electron's own Node.js runtime (ELECTRON_RUN_AS_NODE) in production so the
  // bundled backend runs on a known Node version. The DB native binding (@libsql)
  // is N-API (ABI-stable across Node versions), so no electron-rebuild is needed —
  // but pinning the runtime keeps behaviour identical to `pnpm start`.
  const nodeExec = is.dev ? 'node' : process.execPath

  log(`backend path: ${backendPath}`)
  log(`backend args: ${JSON.stringify(args)}`)
  log(`backend cwd: ${cwd}`)
  log(`node exec: ${nodeExec}`)
  // Compute the migrations path here in the main process where we know
  // process.resourcesPath reliably, then pass it as an env var so the backend
  // bundle never has to guess via process.cwd() (which can differ on Windows).
  const migrationsDir = is.dev
    ? join(__dirname, '../../../../drizzle/migrations')
    : join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'drizzle', 'migrations')

  backendProcess = spawn(nodeExec, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: is.dev ? 'development' : 'production',
      PORT: String(BACKEND_PORT),
      JWT_SECRET: getPersistentJwtSecret(),
      OAUTH_SERVER_URL: `http://localhost:${BACKEND_PORT}`,
      MIGRATIONS_DIR: migrationsDir,
      BACKEND_NONCE: BACKEND_NONCE,
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

// Minimal dark splash screen shown while the backend warms up.
const SPLASH_HTML = `data:text/html;charset=UTF-8,` + encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;height:100vh;
  font-family:system-ui,-apple-system,sans-serif;user-select:none}
.ring{width:2.5rem;height:2.5rem;border:3px solid #27272a;
  border-top:3px solid #6366f1;border-radius:50%;
  animation:spin .9s linear infinite;margin-bottom:1.5rem}
@keyframes spin{to{transform:rotate(360deg)}}
h2{font-size:1.2rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.4rem}
p{font-size:.78rem;color:#71717a}
</style></head>
<body><div class="ring"></div><h2>Starting Omnecor</h2><p>Loading backend services&hellip;</p></body></html>`)

const ERROR_HTML = `data:text/html;charset=UTF-8,` + encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;height:100vh;padding:2rem;text-align:center;
  font-family:system-ui,-apple-system,sans-serif}
h2{color:#f87171;font-size:1.1rem;font-weight:700;margin-bottom:.75rem}
p{font-size:.8rem;color:#71717a;max-width:400px;line-height:1.5}
</style></head>
<body><h2>&#9888; Backend failed to start</h2>
<p>The Omnecor backend did not respond within 40 seconds.<br>
Please restart the app. If the problem persists, check<br>
<code style="color:#a1a1aa">~/.omnecor/</code> for error logs or reinstall.</p></body></html>`)

async function createWindow(): Promise<void> {
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

  // Show splash immediately so the window appears while backend warms up.
  // Loading the real app URL before the backend is ready lets users click
  // auth buttons into a dead backend — the splash prevents that entirely.
  mainWindow.loadURL(SPLASH_HTML)

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

  // Navigation policy:
  //  - app://omnecor/ — our own Electron frontend (always allowed)
  //  - http://localhost:PORT — backend OAuth initiation and callback endpoints
  //  - https:// — external OAuth provider pages (Google, Microsoft) shown in-window
  //  - anything else — blocked; safe https: links open in the system browser
  const backendOrigin = `http://localhost:${BACKEND_PORT}`
  const backendOriginAlt = `http://127.0.0.1:${BACKEND_PORT}`
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed =
      url.startsWith('app://omnecor/') ||
      url.startsWith(backendOrigin) ||
      url.startsWith(backendOriginAlt) ||
      url.startsWith('https://') ||        // OAuth provider pages
      (!!devUrl && url.startsWith(devUrl))
    if (!allowed) {
      event.preventDefault()
      log(`Blocked navigation to: ${url}`)
      if (isSafeExternalUrl(url)) shell.openExternal(url)
    }
  })

  // After OAuth completes the backend redirects to http://localhost:PORT/
  // (or /setup). Snap the window back to app://omnecor/ so the Electron
  // frontend (with preload / window.api) takes over again.
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    try {
      const { hostname, port, pathname } = new URL(url)
      if (
        (hostname === 'localhost' || hostname === '127.0.0.1') &&
        port === String(BACKEND_PORT) &&
        (pathname === '/' || pathname === '/setup' || pathname === '/dashboard')
      ) {
        log(`OAuth callback complete at ${url} — returning to app://omnecor/`)
        mainWindow.loadURL('app://omnecor/')
      }
    } catch { /* ignore malformed URLs */ }
  })

  // Recovery: if a navigation to the backend fails (ERR_CONNECTION_REFUSED,
  // wrong port, backend crashed) the renderer ends up on an error page.
  // Redirect back to the app so the user isn't stuck on a Chromium error page.
  mainWindow.webContents.on('did-fail-load', (_event, _code, desc, failedUrl) => {
    try {
      const { hostname, port } = new URL(failedUrl)
      if (
        (hostname === 'localhost' || hostname === '127.0.0.1') &&
        port === String(BACKEND_PORT)
      ) {
        log(`Navigation to backend failed (${desc}) — returning to app://omnecor/`)
        mainWindow.loadURL('app://omnecor/')
      }
    } catch { /* non-url failures (e.g. data: aborted) — ignore */ }
  })

  // Mirror renderer-side warnings/errors (incl. preload/contextBridge failures)
  // into the main debug log. Without this, a broken preload — e.g. window.api
  // never exposed ("Desktop bridge not ready") — leaves no trace in the log
  // because renderer console output doesn't reach the main process by default.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) log(`[Renderer ${level === 3 ? 'ERROR' : 'WARN'}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log(`[Preload ERROR] ${preloadPath}: ${error.message}\n${error.stack ?? ''}`)
  })

  // Backend readiness gate: wait for /health before loading the real app.
  // The splash is already showing; switch to the app once backend is warm.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    waitForBackend(Number(BACKEND_PORT)).then(ready => {
      if (ready) {
        mainWindow.loadURL('app://omnecor/')
      } else {
        mainWindow.loadURL(ERROR_HTML)
      }
    })
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

  // --- IPC: OAuth popup window ---
  // Opens a dedicated BrowserWindow for the OAuth flow so the main window
  // never navigates away from app://omnecor/. When the backend OAuth callback
  // redirects to localhost:PORT/setup (or /dashboard), we read the session
  // cookie from the backend's session and return it to the renderer which
  // stores it as a Bearer token in localStorage.
  ipcMain.handle('oauth-start', async (_event, oauthUrl: string): Promise<{ token?: string; error?: string }> => {
    log(`oauth-start IPC called: ${oauthUrl}`)
    return new Promise((resolve) => {
      let popup: BrowserWindow
      try {
        popup = new BrowserWindow({
          width: 900,
          height: 700,
          title: 'Sign in to Omnecor',
          autoHideMenuBar: true,
          parent: BrowserWindow.getAllWindows()[0],
          modal: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          }
        })
      } catch (err) {
        log(`Failed to create OAuth popup BrowserWindow: ${String(err)}`)
        resolve({ error: String(err) })
        return
      }

      popup.loadURL(oauthUrl).catch(err => {
        log(`popup.loadURL failed: ${String(err)}`)
      })
      log(`OAuth popup opened: ${oauthUrl}`)

      const onNavigate = async (_ev: Electron.Event, url: string) => {
        try {
          const { hostname, port, pathname } = new URL(url)
          if (
            (hostname === 'localhost' || hostname === '127.0.0.1') &&
            port === String(BACKEND_PORT) &&
            (pathname === '/setup' || pathname === '/dashboard' || pathname === '/')
          ) {
            // OAuth succeeded — read the session cookie set by the backend callback
            const cookies = await session.defaultSession.cookies.get({
              url: `http://localhost:${BACKEND_PORT}`
            })
            const sessionCookie = cookies.find(c => c.name === 'app_session_id')
            log(`OAuth popup success — session cookie ${sessionCookie ? 'found' : 'NOT found'}`)
            popup.destroy()
            resolve({ token: sessionCookie?.value })
          }
        } catch {
          /* URL parse error — ignore */
        }
      }

      popup.webContents.on('did-navigate', onNavigate)

      popup.on('closed', () => {
        log('OAuth popup closed by user')
        resolve({})
      })
    })
  })

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })


  freePortIfBusy(Number(BACKEND_PORT))
  startBackend()
  createWindow().catch(err => log(`createWindow error: ${String(err)}`))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(err => log(`createWindow (activate) error: ${String(err)}`))
    }
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
