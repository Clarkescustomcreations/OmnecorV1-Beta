# Installation Guide for Omnecor

This guide provides comprehensive instructions for installing and setting up Omnecor on various operating systems. Omnecor is designed to be a local-first AI workstation, and these instructions will help you get it running efficiently on your machine.

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Prerequisites](#2-prerequisites)
3. [Installation Steps (Source / Dev)](#3-installation-steps-source--dev)
4. [Platform-Specific Packages](#4-platform-specific-packages)
   - 4.1 [Linux — Debian Package (.deb)](#41-linux--debian-package-deb)
   - 4.2 [Linux — AppImage (portable)](#42-linux--appimage-portable)
   - 4.3 [Linux — Flatpak](#43-linux--flatpak)
   - 4.4 [Linux — systemd Service](#44-linux--systemd-service)
   - 4.5 [Windows — NSIS Installer / Portable EXE](#45-windows--nsis-installer--portable-exe)
   - 4.6 [Android — Thin Client APK](#46-android--thin-client-apk)
5. [Building All Packages](#5-building-all-packages)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. System Requirements

| Component | Minimum Requirement | Recommended for Local LLM Inference |
|---|---|---|
| **Operating System** | Debian 12, Ubuntu 20.04+ (LTS recommended) | Debian 12, Ubuntu 22.04+ |
| **CPU** | 4+ physical cores | 8+ physical cores |
| **RAM** | 8 GB | 16 GB+ |
| **Disk Space** | 20 GB free (NVMe SSD) | 50 GB+ (NVMe SSD) |
| **Network** | Stable connection for API provider calls | Stable connection |
| **Node.js** | 22+ | 24.15.0 (pinned for beta) |
| **pnpm** | 10.x | 10.4.1 (pinned for beta) |
| **GPU** | Optional | NVIDIA 8 GB+ VRAM (RTX 3060 or higher) for local LLMs |

---

## 2. Prerequisites

Before proceeding with the installation, ensure the following are installed:

- **Git** — for cloning the repository.
- **Node.js v24.15.0** (minimum v22) — download from [nodejs.org](https://nodejs.org/en/download/).
- **pnpm v10.4.1** (minimum 10.x):

  ```bash
  npm install -g pnpm@10.4.1
  ```

---

## 3. Installation Steps (Source / Dev)

### Step 1: Clone the Repository

```bash
git clone https://github.com/Clarkescustomcreations/OmnecorV1-Beta.git
cd OmnecorV1-Beta
```

### Step 2: Install Dependencies

```bash
pnpm install
```

This installs all packages for both the client and server components.

### Step 3: Configure Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```env
PORT=3000
# OLLAMA_ENDPOINT=http://localhost:11434
# DATABASE_URL=mysql://user:pass@localhost:3306/omnecor
```

Refer to `server/_core/env.ts` for the complete list of supported environment variables.

### Step 4: Database Setup

Omnecor supports two database backends via the `OMNECOR_DB` environment variable (default: `auto`):

- **SQLite (default, zero-infra)** — No setup required. A local SQLite file is created automatically at `./data/omnecor.db` on first launch. Recommended for single-user / offline use.

- **MySQL / MariaDB (multi-user / production)** — Requires a running MySQL/MariaDB instance:

  ```bash
  # Option A: system MariaDB
  sudo apt install mariadb-server
  # then set DATABASE_URL in .env, then:
  pnpm run db:push

  # Option B: Docker
  docker compose up -d db
  ```

### Step 5: Build the Application

```bash
pnpm run build
```

Compiles the frontend (Vite) and transpiles the server TypeScript.

### Step 6: Start the Application

```bash
pnpm run start
```

Omnecor starts on `http://localhost:3000` by default. If the port is occupied it auto-selects the next available port and prints the URL to the terminal.

---

## 4. Platform-Specific Packages

Pre-built packages bundle the application with Electron (desktop GUI) or ship as a standalone server package. You can also build them yourself using the scripts in `packaging/`.

---

### 4.1 Linux — Debian Package (.deb)

**Install a pre-built .deb:**

```bash
sudo dpkg -i omnecor-hmci_2.3.0_amd64.deb
sudo apt-get install -f          # resolve any missing dependencies
omnecor                          # launch from PATH
```

**Install layout after dpkg install:**

| Path | Contents |
|---|---|
| `/opt/omnecor/` | Application files |
| `/usr/bin/omnecor` | Launcher symlink |
| `/usr/share/applications/omnecor.desktop` | Desktop entry (app menu) |
| `/etc/omnecor/` | Default configuration |
| `/var/lib/omnecor/` | Runtime data (VectorDB, backups) |
| `/lib/systemd/system/omnecor.service` | systemd unit |

**Build the .deb yourself:**

```bash
./packaging/build-deb.sh           # builds dist/omnecor-hmci_2.3.0_amd64.deb
./packaging/build-deb.sh 2.4.0     # override version
```

Requirements: `dpkg-deb`, `fakeroot` (optional), Node.js, Python 3.

**Uninstall:**

```bash
sudo dpkg -r omnecor-hmci
```

---

### 4.2 Linux — AppImage (portable)

AppImage is a single self-contained executable — no installation or root required.

**Run a pre-built AppImage:**

```bash
chmod +x Omnecor-2.3.0.AppImage
./Omnecor-2.3.0.AppImage
```

**Integrate with your desktop (optional):**

```bash
./Omnecor-2.3.0.AppImage --appimage-extract-and-run --install
```

This places a launcher in `~/.local/share/applications/` and creates a `~/.local/bin/omnecor` symlink.

**Build the AppImage yourself:**

```bash
./packaging/build-appimage.sh
# output: dist/Omnecor-2.3.0.AppImage
```

Requirements: `appimagetool` or `electron-builder` with `appImage` target.

**Persistent data location:** `~/.config/omnecor/` and `~/.local/share/omnecor/`.

---

### 4.3 Linux — Flatpak

Flatpak runs Omnecor in a sandboxed container.

**Install from a local bundle:**

```bash
flatpak install --user omnecor.flatpak
flatpak run org.omnecor.HMCI
```

**Build the Flatpak bundle yourself:**

```bash
./packaging/build-flatpak.sh
# output: dist/omnecor.flatpak
```

Requirements: `flatpak-builder`, the GNOME Platform runtime (version 45).

**Note:** Flatpak sandboxing restricts access to devices like serial ports (ESPTool) and GPU passthrough. For hardware bridges, prefer the `.deb` or AppImage install.

---

### 4.4 Linux — systemd Service

The `.deb` package ships a systemd unit that runs Omnecor as a background service.

**Enable and start:**

```bash
sudo systemctl enable omnecor
sudo systemctl start omnecor
sudo journalctl -u omnecor -f    # follow logs
```

**Service configuration:**

Edit `/etc/omnecor/omnecor.env` to set environment variables (e.g., `PORT`, `OLLAMA_ENDPOINT`) without modifying the unit file.

**Status:**

```bash
sudo systemctl status omnecor
```

---

### 4.5 Windows — NSIS Installer / Portable EXE

Omnecor ships a Windows installer built with NSIS via Electron.

**Installer variants:**

| File | Description |
|---|---|
| `Omnecor-Setup-2.3.0.exe` | NSIS installer — recommended. Installs per-user (no UAC required by default). |
| `Omnecor-2.3.0-portable.exe` | Portable — run anywhere with no install. |

**What the NSIS installer does:**

- Installs to `%LOCALAPPDATA%\Programs\Omnecor\` by default.
- Creates a desktop shortcut and Start Menu entry under `Omnecor HMCI`.
- Downloads and silently installs **Ollama** if not already present.
- Checks that Node.js 20+ is available; warns if missing.
- Writes version and install path to `HKCU\Software\Omnecor\HMCI`.

**System requirements for Windows:**

- Windows 10 / 11 (x64)
- Node.js v24.15.0 (the installer will prompt if missing)
- C++ Build Tools (Visual Studio "Desktop development with C++") — required for native modules (`better-sqlite3`, `onnxruntime-node`)

**Uninstall:**

Settings → Apps → Omnecor HMCI → Uninstall. Registry entries are removed automatically.

**Build the Windows installer yourself:**

```powershell
# On a native Windows machine (recommended for correct native module ABIs):
cd packaging\electron-app
pnpm install
pnpm build:win
# output: packaging\electron-app\dist\Omnecor-Setup-2.3.0.exe

# Cross-compile from Linux via Docker (Wine):
./packaging/build-all.sh --target win
```

> **Note on native modules:** `better-sqlite3` and `onnxruntime-node` contain C++ compiled binaries. For a reliable Windows installer, build on a native Windows machine. Cross-compiling from Linux is possible for the UI but may not produce correct Windows `.node` binaries.

For the full Windows build reference, see [packaging/windows/BUILD-WINDOWS.md](packaging/windows/BUILD-WINDOWS.md).

---

### 4.6 Android — Thin Client APK

The Omnecor Android app is a **thin client** that connects to a running Omnecor desktop instance over your local network (Wi-Fi / LAN). It provides the full workstation UI on a mobile screen.

**System requirements for building:**

- JDK 17
- Android SDK (Target SDK 34, Build Tools 34.0.0+) — install via Android Studio
- Node.js & pnpm (see section 2)

**Install a pre-built debug APK (sideload):**

1. Enable Developer Options on your Android device.
2. Enable **USB Debugging** and **Install via USB**.
3. Copy `app-debug.apk` to the device and open via a file manager, **or** run:

   ```bash
   adb install app-debug.apk
   ```

**Build the APK yourself:**

```bash
# From the project root
pnpm install
pnpm build:android          # bundles the Capacitor web assets

# Then compile with Gradle:
cd packaging/electron-app/android
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

**Or build and deploy in one step:**

```bash
cd packaging/electron-app/android
./gradlew installDebug      # installs directly to a connected device via USB
```

**Connect to your desktop brain:**

1. Ensure your Android device and desktop are on the **same Wi-Fi network**.
2. Launch Omnecor on Android.
3. In the **Setup Wizard → Local Network** step, enter the IP address of your desktop workstation.
4. The app proxies all requests to the desktop backend and delivers the full workstation experience.

**Set the server IP at build time (optional):**

```bash
OMNECOR_SERVER_IP="192.168.1.100" pnpm build:android
```

**Build a signed release APK (for distribution):**

In Android Studio: **Build → Generate Signed Bundle / APK → APK**, then follow the signing wizard.

For the full Android build reference, see [packaging/android/BUILD-ANDROID.md](packaging/android/BUILD-ANDROID.md).

---

## 5. Building All Packages

The master build script orchestrates all targets:

```bash
./packaging/build-all.sh                         # all Linux targets (default)
./packaging/build-all.sh --target linux win      # Linux + Windows
./packaging/build-all.sh --target android        # APK only
./packaging/build-all.sh --target flatpak        # Flatpak bundle only
./packaging/build-all.sh --target deb            # standalone .deb only
./packaging/build-all.sh --target all            # everything
./packaging/build-all.sh --version 2.4.0         # override version string
./packaging/build-all.sh --skip-backend-build    # skip tsc/vite build (use existing dist/)
```

**Output directory:** `dist/`

---

## 6. Troubleshooting

Refer to [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for solutions to common problems:

- Port conflicts on startup
- Dependency install failures (`better-sqlite3`, `onnxruntime-node` native compile errors)
- Database connection issues
- Ollama not reachable
- Windows native module ABI mismatches
- Android APK Gradle sync failures
- AppImage FUSE errors on newer kernels (`--appimage-extract-and-run` flag workaround)
