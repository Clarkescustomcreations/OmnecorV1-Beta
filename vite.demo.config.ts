import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const DEMO_BASE = "/OmnecorV1-Beta/demo";

// GitHub Pages serves this app from a subpath with no backend. This plugin
// bakes two demo-only concerns into the generated index.html so they survive
// every rebuild (instead of being hand-patched):
//   1. class="dark" on <html> — render dark theme before React hydrates.
//   2. an SPA-restore script — docs/404.html redirects unknown routes to
//      `?p=<path>`; this decodes it back into the URL before the app loads.
function demoIndexHtml(): Plugin {
  return {
    name: "demo-index-html",
    transformIndexHtml(html) {
      return html
        .replace('<html lang="en">', '<html lang="en" class="dark">')
        .replace(
          "</head>",
          `  <script>
      (function () {
        var p = new URLSearchParams(window.location.search).get("p");
        if (p) {
          window.history.replaceState(
            null, "",
            "${DEMO_BASE}" + decodeURIComponent(p) + window.location.hash
          );
        }
      })();
    </script>
  </head>`
        );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), demoIndexHtml()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  base: "/OmnecorV1-Beta/demo/",
  define: {
    "import.meta.env.VITE_DEMO_MODE": JSON.stringify("true"),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-demo/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      external: ['tiktoken', /tiktoken\/.*/],
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) return "vendor-codemirror";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          if (id.includes("node_modules/three") || id.includes("node_modules/@react-three")) return "vendor-three";
          if (id.includes("node_modules/@radix-ui")) return "vendor-radix";
          if (id.includes("node_modules/@tanstack") || id.includes("node_modules/@trpc") || id.includes("node_modules/zod")) return "vendor-data";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/reactflow")) return "vendor-charts";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/framer-motion")) return "vendor-react";
        },
      },
    },
  },
});
