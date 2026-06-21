# Omnecor — Windows 11 Build Guide

## Method 1: Build on Windows Natively (Recommended)

### Prerequisites
- Windows 10/11 (x64)
- [Node.js v24.15.0](https://nodejs.org) (pinned for beta)
- [pnpm v10.4.1](https://pnpm.io): `npm install -g pnpm@10.4.1`
- Git for Windows
- **C++ Build Tools**: Required for compiling native modules like `better-sqlite3`. Install "Desktop development with C++" via the [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

### Important: Native Modules
Omnecor uses native C++ modules (`better-sqlite3`, `onnxruntime-node`). While `pnpm install` attempts to fetch prebuilt binaries, it is **highly recommended** to build the production installer on a native Windows machine to ensure the correct ABI compatibility. 

Cross-compiling from Linux using Wine is possible for the UI but often fails to package the correct Windows `.node` binaries for the backend.

### Steps

```powershell
# 1. Clone/open the project
cd OmnecorV1-Beta

# 2. Build the backend
pnpm install
pnpm build

# 2b. Pull the Valet Router GGUF model (downloaded from GitHub Releases,
#     NOT Git LFS — the GGUF is gitignored and ships as a release asset)
bash scripts/fetch-valet-model.sh
# (If the GGUF is already present locally from a prior train/build, this
#  script detects it and just verifies the SHA-256 + writes current.json.)

# 3. Build the Windows installer
cd packaging\electron-app
pnpm install
pnpm build:win
```

Output: `packaging\electron-app\dist\`
- `Omnecor-Setup-2.3.0-beta.1.exe` — NSIS installer (recommended)
- `Omnecor-2.3.0-beta.1-portable.exe` — Portable (no install needed)

---

## Method 2: Cross-Compile from Linux via Docker

```bash
# Build Windows installer from a Linux host using Wine in Docker
./packaging/build-all.sh --target win
```

This uses the `electronuserland/builder:wine` Docker image automatically.

---

## Method 3: Cross-Compile via Wine (local)

```bash
sudo apt install wine wine64
./packaging/build-all.sh --target win
```

---

## NSIS Customization

The file `packaging/windows/omnecor.nsh` is included by `electron-builder.yml`
and adds:
- **Ollama silent install** — downloads and installs Ollama during setup
- **Node.js check** — warns if Node.js 20+ is missing
- **Registry entries** — writes version/install path to `HKCU\Software\Omnecor`

---

## Installer Behaviour

| Action | Behaviour |
|--------|-----------|
| Install | Per-user (no UAC needed by default) |
| Desktop shortcut | Created automatically |
| Start Menu | `Omnecor` entry |
| Ollama | Downloaded + installed silently if absent |
| Uninstall | Available from Settings → Apps; removes registry entries |

---

## APK (Omnecor HQ) from Windows

The Android app is **Omnecor HQ**, a standalone React Native / Expo project at
`packaging/android/omnecor-hq/`. Building it from Windows requires JDK 17, the
Android SDK (Target SDK 34) and the NDK r26+ (for the `llama.rn` native build).

```powershell
cd packaging\android\omnecor-hq
pnpm install
pnpm apk:release
# output: android\app\build\outputs\apk\release\app-release.apk
```

For a sideloadable debug build instead, run `pnpm apk:debug`. Then sign the
release APK in Android Studio (**Build → Generate Signed Bundle / APK → APK**)
for Play Store distribution.

The phone connects to your desktop over LAN Wi-Fi or Tailscale — set the
server IP in-app (Settings → Omnecor Server), not at build time. See
[../android/BUILD-ANDROID.md](../android/BUILD-ANDROID.md) for the full guide.
