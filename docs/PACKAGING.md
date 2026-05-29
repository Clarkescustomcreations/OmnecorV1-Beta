# Omnecor HMCI — Linux Packaging & Distribution

This document describes the process of building and distributing Omnecor HMCI for Linux systems using various package formats.

## 📂 Packaging Directory Structure

The `packaging/` directory contains the necessary scripts and templates for building different package formats:

- `build-deb.sh`: Script to generate a Debian package (.deb).
- `build-appimage.sh`: Script to generate a portable AppImage.
- `build-flatpak.sh`: Script to generate a Flatpak bundle.

---

## 📦 Debian Package (.deb)

The Debian package is suitable for Debian, Ubuntu, Linux Mint, and other derivatives. It integrates with the system via `systemd` and `apt`.

### Prerequisites
- `dpkg-deb` (standard on Debian-based systems)
- `fakeroot` (recommended for proper file ownership)
- `Node.js` (for building the backend assets)

### Build Instructions
Run the build script from the project root:
```bash
./packaging/build-deb.sh --version 2.0.0
```

### Installation
```bash
sudo dpkg -i dist/omnecor_2.0.0_amd64.deb
sudo apt-get install -f  # To resolve any missing dependencies
```

### System Integration
- **Service**: Managed via `systemctl start omnecor`.
- **Config**: Located at `/etc/omnecor/omnecor.conf`.
- **Data**: Stored in `/var/lib/omnecor/`.
- **Logs**: Located at `/var/log/omnecor/`.

---

## 🚀 AppImage (Portable)

AppImages are distribution-agnostic and contain all necessary dependencies, including a bundled Node.js runtime.

### Prerequisites
- `wget` or `curl` (to fetch `appimagetool` and Node.js binaries)

### Build Instructions
```bash
./packaging/build-appimage.sh --version 2.0.0
```

### Usage
```bash
chmod +x dist/Omnecor-2.0.0-x86_64.AppImage
./dist/Omnecor-2.0.0-x86_64.AppImage
```

---

## 📦 Flatpak (Sandboxed)

Flatpak provides a sandboxed environment with fine-grained permission control.

### Prerequisites
- `flatpak-builder`
- `flatpak` with the Freedesktop SDK/Runtime (version 23.08)

### Build Instructions
```bash
./packaging/build-flatpak.sh --version 2.0.0
```

If `flatpak-builder` is missing some runtimes, the script will generate a `dist/build-flatpak-on-host.sh` which can be used on a fully configured build machine.

### Installation & Execution
```bash
flatpak install --user dist/io.omnecor.Omnecor.flatpak
flatpak run io.omnecor.Omnecor
```

---

## 🛠️ Common Build Steps

All packaging scripts perform the following high-level operations:
1. **Clean**: Remove previous build artifacts in `dist/`.
2. **Bundle**: Gather backend source code, Python microservices, and assets.
3. **Environment**: Set up `OMNECOR_DATA` and `OMNECOR_CONFIG` environment variables.
4. **Launcher**: Create a standardized entry point script.
5. **Metadata**: Generate desktop entries, icons, and package manifests.
