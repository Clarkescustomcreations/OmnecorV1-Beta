const path = require("path");
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// pnpm workspace root — three levels up from packaging/android/omnecor-hq/
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const config = getDefaultConfig(__dirname);

// Ensure Metro watches the workspace root so hoisted pnpm packages (whisper.rn,
// etc.) are hashable. Without this, Metro fails with "Failed to get the SHA-1"
// for any file that lives in the root node_modules instead of the local one.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  WORKSPACE_ROOT,
];

const nwConfig = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});

// ── Single-instance React (pnpm monorepo dedupe) ──────────────────────────────
// This repo's pnpm workspace hosts THREE React lines (web 19.2.x, electron 18.x,
// mobile 19.1.0). pnpm can surface more than one physical copy of react inside
// the mobile bundle (e.g. a nested copy inside a native module), which breaks
// React hooks/Context — NativeWind's cssInterop throws
// "Cannot read property 'useContext' of null" at startup in a release build.
// Force every import of react / react-dom (and their subpaths) to resolve to
// THIS app's single copy. NOTE: we deliberately do NOT include "react-native"
// here — only `react` was duplicated by pnpm, and routing react-native through
// Node's require.resolve would bypass Metro's platform-extension resolution
// (.android.js / .native.js), breaking platform modules like the touch
// responder system (UI renders but taps do nothing).
// ── nanoid: force browser entry (Web Crypto) ─────────────────────────────────
// nanoid's package.json sets "react-native": "index.js" which uses Node.js
// crypto.randomFillSync — not available in Hermes. The browser entry uses
// crypto.getRandomValues which react-native-get-random-values patches.
// Only redirect the root "nanoid" import; sub-paths (nanoid/non-secure, etc.)
// fall through to normal resolution.
const NANOID_BROWSER = path.resolve(__dirname, "node_modules/nanoid/index.browser.js");

// ── whisper.rn: redirect the bare root specifier ──────────────────────────────
// whisper.rn's package.json "exports" map only declares subpaths ("./*") and has
// NO "." root entry. With Metro's package-exports enabled (Expo SDK 54 default),
// the documented `import ... from "whisper.rn"` cannot resolve. Point the root
// specifier at the package's CommonJS entry; subpaths (whisper.rn/realtime-
// transcription, …) still resolve normally through exports. Mirrors the nanoid
// intercept below. tsconfig `paths` maps the same specifier for type-checking.
// pnpm hoists whisper.rn to the workspace root — check local first, then root.
const _WHISPER_LOCAL = path.resolve(__dirname, "node_modules/whisper.rn/lib/commonjs/index.js");
const _WHISPER_ROOT = path.resolve(WORKSPACE_ROOT, "node_modules/whisper.rn/lib/commonjs/index.js");
const WHISPER_RN_INDEX = fs.existsSync(_WHISPER_LOCAL) ? _WHISPER_LOCAL : _WHISPER_ROOT;

const SINGLETONS = ["react", "react-dom"];
const prevResolveRequest = nwConfig.resolver.resolveRequest;
nwConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "nanoid") {
    return { type: "sourceFile", filePath: NANOID_BROWSER };
  }
  if (moduleName === "whisper.rn") {
    return { type: "sourceFile", filePath: WHISPER_RN_INDEX };
  }
  const hit = SINGLETONS.find((n) => moduleName === n || moduleName.startsWith(n + "/"));
  if (hit) {
    try {
      return { type: "sourceFile", filePath: require.resolve(moduleName, { paths: [__dirname] }) };
    } catch {
      /* fall through to default resolution */
    }
  }
  return prevResolveRequest
    ? prevResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = nwConfig;
