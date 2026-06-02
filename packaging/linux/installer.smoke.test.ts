/**
 * Linux packaging smoke tests — deb, AppImage, Flatpak, systemd.
 *
 * Validates static configuration without running a real build. Each test
 * corresponds to a specific audit finding; the failure message says exactly
 * what to fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const PACKAGING_DIR = path.resolve(import.meta.dirname, '..');
const PROJECT_ROOT = path.resolve(PACKAGING_DIR, '..');

const BUILD_APPIMAGE = path.join(PACKAGING_DIR, 'build-appimage.sh');
const BUILD_DEB = path.join(PACKAGING_DIR, 'build-deb.sh');
const BUILD_FLATPAK = path.join(PACKAGING_DIR, 'build-flatpak.sh');
const APPRUN = path.join(PACKAGING_DIR, 'appimage', 'AppRun');
const SYSTEMD_SERVICE = path.join(PACKAGING_DIR, 'systemd', 'omnecor.service');
const FLATPAK_MANIFEST = path.join(PACKAGING_DIR, 'flatpak', 'org.omnecor.HMCI.yml');
const DEB_CONTROL = path.join(PACKAGING_DIR, 'deb', 'debian', 'control');
const DEB_POSTINST = path.join(PACKAGING_DIR, 'deb', 'debian', 'postinst');
const ROOT_PKG = path.join(PROJECT_ROOT, 'package.json');

const getBaseVersion = (v: string) => v.replace(/-.*$/, '');

// ── build-appimage.sh ──────────────────────────────────────────────────────

describe('AppImage build script (build-appimage.sh)', () => {
  it('file exists', () => {
    expect(existsSync(BUILD_APPIMAGE)).toBe(true);
  });

  it('passes bash syntax check', () => {
    expect(() => execSync(`bash -n "${BUILD_APPIMAGE}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('default VERSION is not the stale 2.0.0 placeholder', () => {
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(
      script,
      'build-appimage.sh default version is still 2.0.0 — update VERSION="${1:-X.Y.Z}" to match the current release',
    ).not.toContain('VERSION="${1:-2.0.0}"');
  });

  it('does NOT copy from non-existent $PROJECT_ROOT/src', () => {
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(
      script,
      'build-appimage.sh copies from $PROJECT_ROOT/src which does not exist (source is in server/ and client/, compiled output is in dist/)',
    ).not.toMatch(/cp -r "\$PROJECT_ROOT\/src"/);
  });

  it('copies backend from dist/ (the compiled output directory)', () => {
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(
      script,
      'build-appimage.sh must copy from $PROJECT_ROOT/dist/ — run pnpm build first',
    ).toContain('$PROJECT_ROOT/dist');
  });

  it('uses the canonical AppRun from packaging/appimage/AppRun (not a heredoc)', () => {
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(
      script,
      'build-appimage.sh writes its own AppRun via heredoc; use the committed packaging/appimage/AppRun instead',
    ).toContain('appimage/AppRun');
  });

  it('uses set -euo pipefail', () => {
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(script).toContain('set -euo pipefail');
  });
});

// ── packaging/appimage/AppRun ─────────────────────────────────────────────

describe('canonical AppRun (packaging/appimage/AppRun)', () => {
  it('file exists', () => {
    expect(existsSync(APPRUN), `Missing: ${APPRUN}`).toBe(true);
  });

  it('is executable', () => {
    const mode = statSync(APPRUN).mode;
    expect(mode & 0o111, `${APPRUN} is not executable — run: chmod +x ${APPRUN}`).toBeGreaterThan(0);
  });

  it('entry point is index.js (the esbuild output), not src/app.js', () => {
    const appRun = readFileSync(APPRUN, 'utf8');
    expect(
      appRun,
      'AppRun launches src/app.js which does not exist; entry point is index.js (from dist/)',
    ).not.toContain('src/app.js');
    expect(appRun, 'AppRun must exec node index.js').toContain('exec node index.js');
  });

  it('does NOT use --experimental-specifier-resolution=node (removed in Node 20+)', () => {
    const appRun = readFileSync(APPRUN, 'utf8');
    expect(
      appRun,
      '--experimental-specifier-resolution=node was removed in Node 20; drop the flag',
    ).not.toContain('--experimental-specifier-resolution=node');
  });

  it('sets NODE_ENV=production', () => {
    const appRun = readFileSync(APPRUN, 'utf8');
    expect(appRun).toContain('NODE_ENV=production');
  });
});

// ── systemd service ────────────────────────────────────────────────────────

describe('systemd service (omnecor.service)', () => {
  it('file exists', () => {
    expect(existsSync(SYSTEMD_SERVICE), `Missing: ${SYSTEMD_SERVICE}`).toBe(true);
  });

  it('does NOT use --experimental-specifier-resolution=node (removed in Node 20+)', () => {
    const svc = readFileSync(SYSTEMD_SERVICE, 'utf8');
    expect(
      svc,
      '--experimental-specifier-resolution=node was removed in Node 20+; remove the flag from ExecStart',
    ).not.toContain('--experimental-specifier-resolution=node');
  });

  it('ExecStart targets dist/index.js (the esbuild output)', () => {
    const svc = readFileSync(SYSTEMD_SERVICE, 'utf8');
    expect(svc).toContain('dist/index.js');
  });

  it('runs as the omnecor service user', () => {
    const svc = readFileSync(SYSTEMD_SERVICE, 'utf8');
    expect(svc).toContain('User=omnecor');
  });

  it('restarts on failure', () => {
    const svc = readFileSync(SYSTEMD_SERVICE, 'utf8');
    expect(svc).toContain('Restart=on-failure');
  });
});

// ── build-deb.sh ──────────────────────────────────────────────────────────

describe('.deb build script (build-deb.sh)', () => {
  it('file exists', () => {
    expect(existsSync(BUILD_DEB)).toBe(true);
  });

  it('passes bash syntax check', () => {
    expect(() => execSync(`bash -n "${BUILD_DEB}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('installs native Node modules into the package (so the server can start)', () => {
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(
      script,
      'build-deb.sh never runs npm install — the bundled dist/index.js externalises better-sqlite3, onnxruntime-node, and mysql2; without node_modules the server exits immediately',
    ).toMatch(/npm install/);
  });

  it('includes better-sqlite3 as a native dependency', () => {
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(script).toContain('better-sqlite3');
  });

  it('includes onnxruntime-node as a native dependency', () => {
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(script).toContain('onnxruntime-node');
  });

  it('bundles the systemd service file', () => {
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(script).toContain('omnecor.service');
  });

  it('sets correct permissions on DEBIAN scripts', () => {
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(script).toContain('chmod 755');
  });
});

// ── deb/debian/postinst ────────────────────────────────────────────────────

describe('deb postinst script', () => {
  it('file exists', () => {
    expect(existsSync(DEB_POSTINST)).toBe(true);
  });

  it('passes bash syntax check', () => {
    expect(() => execSync(`bash -n "${DEB_POSTINST}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('creates the omnecor system user', () => {
    const script = readFileSync(DEB_POSTINST, 'utf8');
    expect(script).toContain('useradd');
    expect(script).toContain('omnecor');
  });

  it('enables the systemd service', () => {
    const script = readFileSync(DEB_POSTINST, 'utf8');
    expect(script).toContain('systemctl enable omnecor.service');
  });
});

// ── Flatpak manifest ───────────────────────────────────────────────────────

describe('Flatpak manifest (org.omnecor.HMCI.yml)', () => {
  it('file exists', () => {
    expect(existsSync(FLATPAK_MANIFEST), `Missing: ${FLATPAK_MANIFEST}`).toBe(true);
  });

  it('runtime version is not 23.08 (EOL since Aug 2024)', () => {
    const yml = readFileSync(FLATPAK_MANIFEST, 'utf8');
    expect(
      yml,
      "Flatpak runtime-version '23.08' reached end-of-life in Aug 2024; bump to '24.08'",
    ).not.toContain("runtime-version: '23.08'");
  });

  it('build-options includes --share=network so npm install can fetch deps', () => {
    const yml = readFileSync(FLATPAK_MANIFEST, 'utf8');
    expect(
      yml,
      'flatpak-builder sandbox is offline by default; add build-args: ["--share=network"] under build-options so npm install succeeds',
    ).toContain('--share=network');
  });

  it('app-id is org.omnecor.HMCI', () => {
    const yml = readFileSync(FLATPAK_MANIFEST, 'utf8');
    expect(yml).toContain('app-id: org.omnecor.HMCI');
  });

  it('uses sdk-extension node20 for the build', () => {
    const yml = readFileSync(FLATPAK_MANIFEST, 'utf8');
    expect(yml).toContain('node20');
  });
});

// ── Version consistency ────────────────────────────────────────────────────

describe('Linux packaging version consistency', () => {
  it('build-deb.sh default version matches base version in package.json', () => {
    const baseVersion = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const script = readFileSync(BUILD_DEB, 'utf8');
    expect(
      script,
      `build-deb.sh VERSION default should be "${baseVersion}" — update: VERSION="\${1:-${baseVersion}}"`,
    ).toContain(`VERSION="\${1:-${baseVersion}}"`);
  });

  it('build-appimage.sh default version matches base version in package.json', () => {
    const baseVersion = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const script = readFileSync(BUILD_APPIMAGE, 'utf8');
    expect(
      script,
      `build-appimage.sh VERSION default should be "${baseVersion}" — update: VERSION="\${1:-${baseVersion}}"`,
    ).toContain(`VERSION="\${1:-${baseVersion}}"`);
  });

  it('deb/debian/control version matches base version in package.json', () => {
    const baseVersion = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const control = readFileSync(DEB_CONTROL, 'utf8');
    expect(
      control,
      `deb/debian/control Version field should be "${baseVersion}"`,
    ).toContain(`Version: ${baseVersion}`);
  });
});
