const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

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

const SINGLETONS = ["react", "react-dom"];
const prevResolveRequest = nwConfig.resolver.resolveRequest;
nwConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "nanoid") {
    return { type: "sourceFile", filePath: NANOID_BROWSER };
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
