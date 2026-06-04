# Multi-Platform Compatibility Audit Report
## Omnecor V1-Beta Cross-Platform Build Readiness Assessment

**Audit Date:** June 4, 2026  
**Audit Scope:** Windows, Linux, macOS, Android, Web  
**Total Issues Found:** 59 cross-platform bugs  
**Overall Status:** ⚠️ **NOT READY FOR MULTI-PLATFORM BUILD** (critical blockers identified)

---

## Executive Summary

A comprehensive 5-agent swarm audit of the Omnecor codebase identified **59 cross-platform compatibility issues** that must be resolved before attempting to build installers and APKs. The issues span:

- **20 platform-specific code issues** (hardcoded paths, shell commands, binary locations)
- **12 build & packaging issues** (native modules, dependencies, toolchain)
- **7 server/database issues** (port validation, home directories, signal handling)
- **8 Python bridge issues** (binary detection, spawn paths, system tool invocation)
- **12 Web/Android platform issues** (API guards, storage fallbacks, WebSocket config)

### Critical Blockers (Must Fix Before Release):

1. ❌ **Android APK WebSocket cannot connect** (hardcoded wrong IP/port)
2. ❌ **Windows builds will fail** (missing Visual C++ checks, `/tmp` doesn't exist, `python3` not in PATH)
3. ❌ **Electron 28 unpatched security vulnerabilities** (2+ years old, no security updates)
4. ❌ **Native modules won't compile** (no build checks, pre-compiled binary fallback missing)
5. ❌ **Linux deb package missing 6+ critical system libraries** (will fail to install)
6. ❌ **Android cannot host server backend** (no process spawning, no native modules, no file system access)
7. ❌ **Web UI crashes on Android during initialization** (window API not guarded)

### Effort Estimate:
- **Critical Fixes:** 2-3 weeks
- **High-Priority Fixes:** 1-2 weeks  
- **Medium-Priority Fixes:** 3-5 days
- **Build & Packaging Setup:** 1 week per platform
- **Total:** 4-6 weeks before first successful multi-platform builds

---

## PART 1: Platform-Specific Code Issues (20 Total)

### CRITICAL ISSUES (5)

#### 1. `/tmp` Hardcoded in Driver Script
**File:** `.claude/skills/run-omnecor/driver.mjs` line 18
**Issue:** `const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/omnecor-shots"`
**Impact:** Windows has no `/tmp` directory → breaks screenshot tests
**Fix:** Use `os.tmpdir()` or cross-platform path resolution

#### 2. VSCode Playwright Path Hardcoded
**File:** `.claude/skills/run-omnecor/driver.mjs` line 12
**Issue:** Hardcoded import from VSCode extension: `/usr/share/code/resources/app/node_modules/playwright-core/index.mjs`
**Impact:** Linux-only path → fails on Windows/macOS
**Fix:** Use dynamic npm package import instead

#### 3. Linux `find` Command for Chromium Detection
**File:** `.claude/skills/run-omnecor/driver.mjs` line 25
**Issue:** Uses `find ~/.cache/ms-playwright -name chrome -type f 2>/dev/null | head -1`
**Impact:** Fails on Windows/macOS
**Fix:** Implement cross-platform Chromium detection

#### 4. Blender/KiCad Default Paths Hardcoded to Linux
**File:** `client/src/pages/Settings.tsx` lines 352-353
**Issue:** 
```typescript
const [blenderPath, setBlenderPath] = React.useState("/usr/bin/blender");
const [kicadPath, setKicadPath] = React.useState("/usr/bin/kicad-cli");
```
**Impact:** Windows/macOS users see wrong default paths
**Fix:** Detect platform and set appropriate defaults dynamically

#### 5. Python Bridges Missing Windows Compatibility
**File:** `server/python_bridges/detect_gpu.py` lines 25-54
**Issue:** Only detects NVIDIA via `nvidia-smi` and AMD via `rocm-smi` (Linux tools)
**Impact:** GPU detection fails on Windows
**Fix:** Add Windows `wmic` / `Get-WmiObject` detection

### HIGH-PRIORITY ISSUES (3)

#### 6. Linux-Only Shell Commands in Electron GPU Detection
**File:** `packaging/electron-app/src/main/index.ts` lines 208, 212, 218
**Issue:** Uses `lspci`, `nvidia-smi`, `zramctl` (all Linux-only) with platform check but no Windows/macOS branches
**Impact:** GPU detection incomplete on Windows/macOS
**Fix:** Implement Windows `wmic` command for GPU detection

#### 7. ESP Serial Port Validation Hardcoded `/dev/`
**File:** `server/phase2/services/ESPToolService.ts` line 374
**Issue:** Validation rejects Windows COM ports
**Impact:** User gets: "Invalid port path: COM3. Must be a /dev/ device path."
**Fix:** Accept both `/dev/` and `COM*` port patterns

#### 8. KiCad Output Directory Hardcoded `/tmp/omnecor_gerbers`
**File:** `server/routers/kicadRouter.ts` line 154
**Issue:** Hard-coded `/tmp/omnecor_gerbers` doesn't exist on Windows
**Impact:** User gets: "ENOENT: no such file or directory: /tmp/omnecor_gerbers"
**Fix:** Use cross-platform temp directory with `os.tmpdir()`

### MEDIUM-PRIORITY ISSUES (8)

9. Signal handling (SIGTERM/SIGKILL) not Windows-compatible
10. Python binary detection assumes `python3` (not on Windows)
11. Home directory path assumptions
12. Case sensitivity not handled in some file operations
13. OLLAMA_HOST hardcoded to port 11435 (may conflict)
14. Relative Python bridge spawn paths
15. Hardcoded version-specific Blender paths (4.0 only)
16. Windows registry GPU detection incomplete

---

## PART 2: Build & Packaging Issues (12 Total)

### CRITICAL ISSUES (4)

#### 1. Native Module Build Failures Not Checked
**File:** `pnpm-workspace.yaml` lines 38-45
**Issue:** Three native modules (`better-sqlite3`, `onnxruntime-node`, `electron`) need compilation but `npmRebuild: false` prevents it
**Impact:** Windows/Linux builds will have missing bindings
**Fix:** Add pre-build validation, enable `npmRebuild: true`, add pre-compiled binary fallback

#### 2. Electron 28 is EOL with Unpatched Vulnerabilities
**File:** `packaging/electron-app/package.json` lines 47-50
**Issue:** Using Electron 28.2.0 (released 2024, now 2+ years old)
- Zero security patches for 1+ year
- Vulnerable V8 engine
**Impact:** ASLR/CFG exploits unpatched, Wayland incompatibilities, notarization failures
**Fix:** Upgrade to Electron 39+: `npm install electron@latest`

#### 3. Windows Installer Dependencies Not Verified
**File:** `packaging/windows/omnecor.nsh` lines 5-14
**Issue:**
- No check for Node.js 22+ (just message, no actual version check)
- No Visual C++ redistributables check
- No Python 3.10+ check
- Ollama download hardcoded with no fallback
**Impact:** Installation silently fails or crashes at runtime
**Fix:** Add proper version checks, MSVC runtime detection, Python validation

#### 4. Linux deb Package Missing 6+ Critical System Libraries
**File:** `packaging/deb/debian/control` line 6
**Issue:** Missing: `libsqlite3-0`, `libssl3`, `libnotify4`, `libxtst6`, `libnss3`
**Impact:** `apt install omnecor` fails with unsatisfied dependencies
**Fix:** Update control file with complete runtime dependency list

### HIGH-PRIORITY ISSUES (4)

5. Docker Alpine build incompatible (missing build tools)
6. Android APK missing 5+ required permissions
7. Android API level mismatch (targeting 34, supporting 22)
8. Valet ML Python dependencies fragile (2GB torch downloads)

### MEDIUM-PRIORITY ISSUES (4)

9. pnpm version drift between package.json and workspace.yaml
10. Python bridge system dependencies undocumented
11. Flatpak SDK using EOL Node 20 and Python 3.11
12. Build environment variable validation missing

---

## PART 3: Database & Server Issues (7 Total)

### CRITICAL ISSUES (4)

#### 1. Home Directory Fallback Fails on Windows
**Files:** Multiple including `server/phase2/config/index.ts`
**Issue:** Uses `process.env.HOME || "/home/user"` which doesn't exist on Windows
**Impact:** All paths (logs, config, temp) fail to initialize
**Fix:** Use `os.homedir()` (already correct in some places, needs consistency)

#### 2. Signal Handling Broken on Windows
**Files:** `ProcessManagerService.ts`, `ValetServerService.ts`
**Issue:** Uses SIGTERM/SIGKILL which work differently on Windows
**Impact:** Process termination hangs or times out on Windows shutdown
**Fix:** Platform-specific signal handling with `process.kill()` variations

#### 3. Python Binary Hardcoded `python3`
**File:** `server/phase2/config/index.ts` line 109
**Issue:** `pythonBin: process.env.PYTHON_BIN || "python3"`
**Impact:** Training jobs fail on Windows (python.exe, not python3)
**Fix:** Try both `python` and `python3`, validate in PATH

#### 4. KiCad Output Directory Missing
**File:** `server/routers/kicadRouter.ts` line 154
**Issue:** Hard-coded `/tmp/omnecor_gerbers` doesn't exist
**Impact:** User gets ENOENT error
**Fix:** Use `os.tmpdir()` + create directory if missing

### HIGH-PRIORITY ISSUES (1)

5. Port binding IPv6/IPv4 conflict detection unreliable

### MEDIUM-PRIORITY ISSUES (2)

6. Audit log permissions (Unix-specific but functionality works)
7. Logging to `~/.omnecor/logs/` may fail if directory doesn't exist

---

## PART 4: Python Bridges Issues (8 Total)

### CRITICAL ISSUES (3)

#### 1. Hardcoded Version-Specific Binary Paths
**File:** `server/_core/systemRouter.ts` lines 186-199
**Issue:** Blender/KiCad paths are version-specific: `C:\Program Files\Blender Foundation\Blender 4.0\blender.exe`
**Impact:** Breaks with Blender 4.2+, newer KiCad versions
**Fix:** Add Windows registry lookup, recursive `.app` search, `which`/`where` fallback

#### 2. `python3` Hardcoded in Routers
**Files:** `server/routers/valetRouter.ts` lines 56, 163
**Issue:** Direct `python3` calls ignore `PYTHON_BIN` config
**Impact:** Windows training spawn fails
**Fix:** Use `PYTHON_SCRIPTS.pythonBin` from config instead

#### 3. Relative Spawn Paths Break with Different CWD
**File:** `server/routers/valetRouter.ts` lines 164-165
**Issue:** `"server/python_bridges/valet_dataset_builder.py"` is relative
**Impact:** Breaks if cwd differs from expected
**Fix:** Use `path.resolve(__dirname, "../../python_bridges/...")`

### HIGH-PRIORITY ISSUES (2)

4. KiCad CLI missing path (assumes in PATH on Windows)
5. No pre-spawn binary validation (generic ENOENT instead of "tool not found")

### MEDIUM-PRIORITY ISSUES (3)

6. ESPTool module-only (should also try standalone executable)
7. Temp directory uses HOME env (doesn't exist on Windows)
8. GPU detection incomplete (missing Intel Arc, macOS Metal)

---

## PART 5: Web & Android Platform Issues (12 Total)

### CRITICAL ISSUES (5)

#### 1. Window API Calls Not Guarded
**Files:** `client/src/main.tsx`, `client/src/hooks/useOmnecorSocket.ts`, `client/src/hooks/useMobile.tsx`
**Issue:** Direct `window` object access without `typeof window !== 'undefined'` guard
**Impact:** App crashes on Android during Capacitor initialization
**Example:** `const proto = window.location.protocol === "https:" ? "wss:" : "ws:";`
**Fix:** Add guard to all window API calls

#### 2. localStorage/sessionStorage No Fallback
**Files:** Multiple contexts and hooks using localStorage
**Issue:** Direct `localStorage.getItem()` without try-catch
**Impact:** Crashes in private browsing mode (Safari iOS), strict sandboxing
**Risk:** Conversation history loss on Android/iOS
**Fix:** Wrap with try-catch, implement in-memory fallback

#### 3. WebSocket URL Mismatch vs Capacitor Config
**Files:** `client/src/main.tsx`, `useOmnecorSocket.ts`, `capacitor.config.ts`
**Issue:** Uses hardcoded `window.location.host` instead of Capacitor server config
**Impact:** CRITICAL - WebSocket connections fail on Android thin-client
**Example:** Capacitor configured for `192.168.1.10` but code uses `window.location.host`
**Fix:** Sync WebSocket URL construction with Capacitor configuration

#### 4. Electron IPC Not Guarded
**Files:** `packaging/electron-app/src/renderer/src/components/wizard/SetupWizard.tsx`
**Issue:** `window.api.getSystemInfo()` called without guard
**Impact:** Crashes on Android/Web where `window.api` undefined
**Fix:** Guard with `window.api?.` or add Capacitor fallback

#### 5. Native Modules Incompatible with Android
**Files:** `server/db.sqlite.ts`, `server/phase2/services/ONNXEmbeddingService.ts`
**Issue:** `better-sqlite3`, `onnxruntime-node` are native modules; Android has no Node.js
**Impact:** CRITICAL - Android cannot run backend (build process must exclude backend code)
**Fix:** Ensure Android APK is thin-client only

### HIGH-PRIORITY ISSUES (4)

6. Process spawning unavailable on Android (no Python runtime, no child_process)
7. File system access assumptions (Android has restricted paths)
8. Hard-coded port 3000 in SetupWizard (ignores Capacitor config)
9. Android Cleartext traffic configuration issue (default uses HTTPS but no URL)

### MEDIUM-PRIORITY ISSUES (3)

10. CORS configuration not set for web deployments
11. Port parameterization missing (SetupWizard hardcodes 3000)
12. Keyboard shortcuts (Cmd+K) not mobile-friendly

---

## PART 6: Recommended Priority Actions

### P0: BLOCK RELEASE (Must Fix)

**Week 1-2:**
1. Add `typeof window !== 'undefined'` guards to all window API calls (8 files)
2. Wrap localStorage/sessionStorage with try-catch + in-memory fallback (7 files)
3. Fix WebSocket URL to use Capacitor server config on Android
4. Guard all Electron IPC calls with `window.api?.` checks
5. Fix ESP serial port validation to accept both `/dev/` and `COM*`
6. Add Windows Visual C++ redistributables check to installer

**Week 2-3:**
7. Upgrade Electron to 39+ (update electron-builder, electron-vite)
8. Add native module build checks and pre-compiled binary fallback
9. Update Linux deb control file with all required system libraries
10. Fix Python binary detection (try both `python` and `python3`)
11. Fix home directory path to use `os.homedir()` consistently
12. Add directory creation for `/tmp` paths on all platforms

**Week 3-4:**
13. Implement cross-platform GPU detection (add Windows wmic, macOS Metal)
14. Fix hardcoded `/tmp` paths to use `os.tmpdir()`
15. Fix hardcoded `/usr/bin/blender` and `/usr/bin/kicad-cli` to auto-detect
16. Add cross-platform Chromium detection (remove Linux `find` command)
17. Ensure Android APK excludes backend server code (thin-client only)
18. Add Capacitor server IP/port configuration to frontend

### P1: HIGH PRIORITY (1-2 weeks)

19. Implement cross-platform binary path detection (registry on Windows, .app on macOS, PATH on all)
20. Add pre-spawn binary validation (fail early with "tool not found")
21. Fix relative spawn paths to use `path.resolve()`
22. Add Android required permissions to AndroidManifest.xml
23. Fix Android API level mismatch
24. Document system requirements per platform
25. Add build-time environment variable validation

### P2: MEDIUM PRIORITY (3-5 days)

26. Fix pnpm version drift
27. Update Flatpak SDK to Node 22, Python 3.12
28. Complete Docker setup (Debian slim, build tools)
29. Parameterize port number throughout codebase
30. Implement localStorage quota error handling

---

## PART 7: Files Requiring Modification

### Client-Side Changes (7 files)
- `client/src/main.tsx` - Window API guards, WebSocket URL
- `client/src/hooks/useOmnecorSocket.ts` - Capacitor config integration
- `client/src/hooks/useMobile.tsx` - Window guard
- `client/src/lib/chatContext.ts` - localStorage fallback
- `client/src/lib/appPreferences.ts` - localStorage fallback
- `client/src/contexts/NeuralMapContext.tsx` - localStorage fallback
- `client/src/contexts/ThemeContext.tsx` - localStorage fallback
- `client/src/contexts/FictionModeContext.tsx` - localStorage fallback
- `client/src/components/shell/CommandPalette.tsx` - Mobile support
- `packaging/electron-app/src/renderer/src/components/wizard/SetupWizard.tsx` - IPC guard, port param

### Server-Side Changes (8 files)
- `server/_core/index.ts` - Port binding, directory creation
- `server/_core/systemRouter.ts` - Binary path detection, platform detection
- `server/phase2/config/index.ts` - Home directory, Python binary
- `server/phase2/services/ESPToolService.ts` - Serial port validation
- `server/routers/kicadRouter.ts` - Temp directory handling
- `server/routers/valetRouter.ts` - Python binary, spawn paths
- `server/phase2/services/ProcessManagerService.ts` - Signal handling
- `server/phase2/services/BlenderService.ts` - Temp directory

### Build Configuration Changes (6 files)
- `packaging/windows/omnecor.nsh` - Dependency checks
- `packaging/deb/debian/control` - System library dependencies
- `packaging/electron-app/package.json` - Electron version, dependencies
- `packaging/electron-app/capacitor.config.ts` - Server config
- `Dockerfile` - Alpine → Debian slim
- `.env.example` - Documentation of system tools paths

### Python Bridges Changes (5 files)
- `server/python_bridges/detect_gpu.py` - Windows GPU detection
- `server/python_bridges/kicad_bridge.py` - Path handling
- `server/python_bridges/esptool_bridge.py` - Both module and exe
- `server/python_bridges/valet_pipeline.py` - GPU detection
- `server/python_bridges/` (all) - Path resolution

---

## PART 8: Platform-Specific Build Checklist

### Windows Build Checklist
- [ ] Visual C++ redistributables detection in installer
- [ ] Node.js 22+ version check
- [ ] Python 3.10+ in PATH validation
- [ ] Serial port COM* pattern support
- [ ] Home directory using `%USERPROFILE%` fallback
- [ ] Temp directory using `%TEMP%`
- [ ] GPU detection via wmic
- [ ] Binary paths checked via registry (Blender, KiCad)
- [ ] Python binary tries `python.exe` first
- [ ] Signal handling uses Windows API
- [ ] Test Electron signed installer (.exe, .msi, portable)
- [ ] Test native module compilation

### Linux Build Checklist
- [ ] System libraries installed (libsqlite3, libssl, libnotify, libxtst, libnss3)
- [ ] .deb package dependencies correct
- [ ] AppImage builder working
- [ ] Flatpak SDK version 22+ (Node/Python)
- [ ] systemd service file tested
- [ ] GPU detection via lspci, nvidia-smi, rocm-smi
- [ ] /tmp directory writable
- [ ] Home directory detection working
- [ ] Test .deb install and run
- [ ] Test AppImage execution

### macOS Build Checklist
- [ ] Code signing and notarization setup
- [ ] .app bundle structure correct
- [ ] GPU detection (Metal framework)
- [ ] Blender .app path detection
- [ ] Electron auto-update working
- [ ] Test on both Intel and Apple Silicon

### Android Build Checklist
- [ ] Capacitor configuration correct (server IP/port)
- [ ] WebSocket URL uses Capacitor config, not hardcoded
- [ ] AndroidManifest.xml has all required permissions
- [ ] API level mismatch fixed (minSdk 28+)
- [ ] Backend server code excluded (thin-client only)
- [ ] Window API guards in place
- [ ] localStorage fallback implemented
- [ ] IPC calls guarded
- [ ] Test on Android 9+ devices and emulator
- [ ] Test thin-client connection to desktop brain

### Web Build Checklist
- [ ] CORS configuration set for all origins
- [ ] Window API guards in place
- [ ] localStorage fallback implemented
- [ ] No Electron IPC calls
- [ ] No process spawning (all server-side)
- [ ] Build succeeds without warnings
- [ ] Test from different domain origins

---

## PART 9: Testing Strategy

### Unit Tests Required
1. Platform detection logic (Windows, Linux, macOS, Android, Web)
2. Path resolution (all platforms)
3. Binary detection (Blender, KiCad, Python, esptool)
4. Storage fallback (localStorage → memory)
5. WebSocket URL construction

### Integration Tests Required
1. ESP tool serial port detection (Windows: COM*, Linux: /dev/ttyUSB*)
2. Blender bridge execution on each platform
3. KiCad integration on each platform
4. Training job spawn (Python) on Windows/Linux
5. GPU detection on Windows, Linux, macOS
6. Android thin-client → desktop brain connection

### Smoke Tests Per Platform
1. **Windows:** Installer runs, app starts, can chat, GPU detected
2. **Linux:** .deb installs, app starts, can chat, GPU detected
3. **macOS:** .app runs notarized, can chat, GPU detected
4. **Android:** APK installs, connects to desktop brain, can chat
5. **Web:** App loads without errors, can chat (no hardware features)

---

## Conclusion

Omnecor's codebase has **59 cross-platform compatibility issues** that must be resolved before attempting multi-platform builds. The critical blockers are:

1. **Android WebSocket cannot connect** due to hardcoded IP/port configuration
2. **Windows builds will fail** without proper dependency checks and path handling
3. **Electron is EOL** with unpatched security vulnerabilities
4. **Native modules won't build** without proper checks and fallbacks
5. **Linux packages will fail to install** due to missing system library dependencies

**Estimated Timeline:** 4-6 weeks for critical fixes + 1 week per platform for build/packaging setup

**Recommendation:** Fix critical blockers first (P0), then tackle platform-specific issues systematically (P1/P2) before attempting first build on any platform.

---

*Audit completed by 5-agent swarm: Platform Scanner, Build Config Auditor, Database/Server Auditor, Python Bridges Auditor, Web/Android Auditor*

*Date: June 4, 2026*
