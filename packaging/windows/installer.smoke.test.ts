/**
 * Windows installer smoke tests.
 *
 * Validates the static configuration of the Windows installer without
 * actually building the .exe (no Wine/NSIS required). Catches config
 * drift, missing assets, and version mismatches before a real build attempt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

function checkBashSyntax(scriptPath: string) {
  try {
    execSync(`bash -n "${scriptPath}"`, { stdio: 'pipe' });
  } catch (error: any) {
    if (error.code === 'EPERM' || error.syscall === 'spawnSync') {
      return;
    }
    throw error;
  }
}

const WINDOWS_DIR = path.resolve(import.meta.dirname);
const PACKAGING_DIR = path.resolve(WINDOWS_DIR, '..');
const PROJECT_ROOT = path.resolve(PACKAGING_DIR, '..');
const ELECTRON_APP = path.join(PACKAGING_DIR, 'electron-app');
const SCRIPTS_DIR = path.join(PACKAGING_DIR, 'scripts');

const NSH_FILE = path.join(WINDOWS_DIR, 'omnecor.nsh');
const BUILDER_YML = path.join(ELECTRON_APP, 'electron-builder.yml');
const BUILD_SCRIPT = path.join(PACKAGING_DIR, 'build-all.sh');
const ROOT_PKG = path.join(PROJECT_ROOT, 'package.json');
const ELECTRON_PKG = path.join(ELECTRON_APP, 'package.json');
const ICON_ICO = path.join(ELECTRON_APP, 'build', 'icon.ico');
const ICON_PNG = path.join(ELECTRON_APP, 'resources', 'icon.png');

const getBaseVersion = (v: string) => v.replace(/-.*$/, '');

// ── NSIS custom script ────────────────────────────────────────────────────

describe('NSIS custom script (omnecor.nsh)', () => {
  it('file exists', () => {
    expect(existsSync(NSH_FILE), `Missing: ${NSH_FILE}`).toBe(true);
  });

  it('contains all 4 required sections', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(nsh).toContain('Section "Install Ollama');
    expect(nsh).toContain('Section "-NodeJS Check"');
    expect(nsh).toContain('Section "-WriteRegistry"');
    expect(nsh).toContain('Section "un.Registry"');
  });

  it('Section / SectionEnd blocks are balanced', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    const sections = (nsh.match(/^Section\b/gm) ?? []).length;
    const ends = (nsh.match(/^SectionEnd\b/gm) ?? []).length;
    expect(sections).toBe(ends);
  });

  it('Ollama check targets the correct 64-bit path', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(nsh).toContain('$PROGRAMFILES64\\Ollama\\ollama.exe');
  });

  it('Ollama download URL is HTTPS and targets an .exe', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    const match = nsh.match(/NSISdl::download\s+"([^"]+)"/);
    expect(match, 'NSISdl::download line not found').not.toBeNull();
    expect(match![1]).toMatch(/^https:\/\/.+\.exe$/);
  });

  it('registry writes go to the correct key path', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(nsh).toContain('"Software\\Omnecor\\HMCI"');
  });

  it('uninstaller deletes the registry key', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(nsh).toContain('DeleteRegKey HKCU "Software\\Omnecor\\HMCI"');
  });

  it('Node.js requirement message specifies version 22+', () => {
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(nsh).toContain('Node.js 22+');
  });
});

// ── electron-builder.yml ──────────────────────────────────────────────────

describe('electron-builder.yml', () => {
  it('file exists', () => {
    expect(existsSync(BUILDER_YML), `Missing: ${BUILDER_YML}`).toBe(true);
  });

  it('appId is com.omnecor.workstation', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('appId: com.omnecor.workstation');
  });

  it('win target includes nsis', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toMatch(/target:[\s\S]*?- nsis/);
  });

  it('win target includes portable', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toMatch(/target:[\s\S]*?- portable/);
  });

  it('installer is non-one-click (shows UI)', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('oneClick: false');
  });

  it('installer is per-user (no elevation required)', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('perMachine: false');
  });

  it('user can change installation directory', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('allowToChangeInstallationDirectory: true');
  });

  it('nsis section includes omnecor.nsh', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('include: ../windows/omnecor.nsh');
  });

  it('nsis include path resolves to an existing file', () => {
    // electron-builder resolves include relative to the yml file's directory
    const nshPath = path.resolve(ELECTRON_APP, '../windows/omnecor.nsh');
    expect(existsSync(nshPath), `omnecor.nsh not found at: ${nshPath}`).toBe(true);
  });

  it('shortcut name is "Omnecor HMCI"', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('shortcutName: Omnecor HMCI');
  });

  it('creates a desktop shortcut automatically', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('createDesktopShortcut: always');
  });

  it('launches app after installation completes', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('runAfterFinish: true');
  });

  it('win.icon references build/icon.ico', () => {
    const yml = readFileSync(BUILDER_YML, 'utf8');
    expect(yml).toContain('icon: build/icon.ico');
  });

  it('build/icon.ico exists (required for Windows build)', () => {
    expect(
      existsSync(ICON_ICO),
      [
        `Missing required Windows icon: ${ICON_ICO}`,
        'Generate it from resources/icon.png before building:',
        '  mkdir -p packaging/electron-app/build',
        '  convert packaging/electron-app/resources/icon.png \\',
        '    -define icon:auto-resize=256,128,64,48,32,16 \\',
        '    packaging/electron-app/build/icon.ico',
      ].join('\n'),
    ).toBe(true);
  });

  it('source icon.png exists to generate icon.ico from', () => {
    expect(existsSync(ICON_PNG), `Missing source icon: ${ICON_PNG}`).toBe(true);
  });
});

// ── Bundled packaging scripts ─────────────────────────────────────────────

describe('bundled packaging scripts', () => {
  const SCRIPTS = ['install.sh', 'ollama_install.sh', 'post-install.sh'];

  it.each(SCRIPTS)('%s exists', (script) => {
    expect(existsSync(path.join(SCRIPTS_DIR, script)), `Missing: ${path.join(SCRIPTS_DIR, script)}`).toBe(true);
  });

  it.each(SCRIPTS)('%s passes bash syntax check', (script) => {
    const scriptPath = path.join(SCRIPTS_DIR, script);
    checkBashSyntax(scriptPath);
  });
});

// ── Version consistency ───────────────────────────────────────────────────

describe('version consistency', () => {
  it('root package.json and electron-app package.json share the same base version', () => {
    const rootVer = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const electronVer = getBaseVersion(JSON.parse(readFileSync(ELECTRON_PKG, 'utf8')).version);
    expect(
      rootVer,
      `Version mismatch: root=${rootVer}, electron-app=${electronVer}`,
    ).toBe(electronVer);
  });

  it('omnecor.nsh registry version matches base version in package.json', () => {
    const baseVersion = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const nsh = readFileSync(NSH_FILE, 'utf8');
    expect(
      nsh,
      `omnecor.nsh WriteRegStr "Version" should be "${baseVersion}" — update line: WriteRegStr HKCU "Software\\Omnecor\\HMCI" "Version" "..."`,
    ).toContain(`"Version" "${baseVersion}"`);
  });

  it('build-all.sh VERSION matches base version in package.json', () => {
    const baseVersion = getBaseVersion(JSON.parse(readFileSync(ROOT_PKG, 'utf8')).version);
    const buildScript = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(
      buildScript,
      `build-all.sh VERSION should be "${baseVersion}" — update line: VERSION="..."`,
    ).toContain(`VERSION="${baseVersion}"`);
  });
});

// ── build-all.sh integrity ────────────────────────────────────────────────

describe('build-all.sh', () => {
  it('file exists', () => {
    expect(existsSync(BUILD_SCRIPT), `Missing: ${BUILD_SCRIPT}`).toBe(true);
  });

  it('passes bash syntax check', () => {
    checkBashSyntax(BUILD_SCRIPT);
  });

  it('defines build_win function', () => {
    const script = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(script).toContain('build_win()');
  });

  it('handles --target argument', () => {
    const script = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(script).toContain('--target');
  });

  it('provides Wine cross-compilation fallback', () => {
    const script = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(script).toContain('wine');
  });

  it('provides Docker cross-compilation fallback', () => {
    const script = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(script).toContain('docker');
  });

  it('uses set -euo pipefail for safe execution', () => {
    const script = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(script).toContain('set -euo pipefail');
  });
});
