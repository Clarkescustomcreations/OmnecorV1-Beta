import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const plugins = [
  react(),
  tailwindcss(),
  jsxLocPlugin(),
];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "tiktoken": path.resolve(import.meta.dirname, "client", "src", "lib", "tokenizer-shim.ts"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Remaining over-limit chunks are all lazily-loaded: per-page bundles
    // (WebPreview, Chat) and Shiki language-syntax files (emacs-lisp ~780kB,
    // cpp ~626kB) that load on demand, so their size never blocks first paint.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // CodeMirror runtime + extensions (editor, not language chunks which auto-split)
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
            return "vendor-codemirror";
          }
          // Lucide icon library — large icon set
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
          // Three.js 3D runtime — designer, PCB 3D viewer, chat canvas. Split out
          // so chart/graph-only pages never download the full 3D engine.
          if (id.includes("node_modules/three") || id.includes("node_modules/@react-three")) {
            return "vendor-three";
          }
          // ReactFlow node-graph runtime — PCB editor, neural graph, workspace canvas.
          if (id.includes("node_modules/reactflow") || id.includes("node_modules/@xyflow")) {
            return "vendor-flow";
          }
          // Recharts charting — wallet/budget panels only; kept apart from the 3D runtime.
          if (id.includes("node_modules/recharts")) {
            return "vendor-charts";
          }
          // Radix UI primitives — large but stable design-system dep
          if (id.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          // TanStack / tRPC / Zod — core data layer
          if (
            id.includes("node_modules/@tanstack") ||
            id.includes("node_modules/@trpc") ||
            id.includes("node_modules/zod")
          ) {
            return "vendor-data";
          }
          // React core + framer-motion (animation)
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/framer-motion")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      allow: [
        path.resolve(import.meta.dirname, "client"),
        path.resolve(import.meta.dirname, "assets"),
        path.resolve(import.meta.dirname, "shared"),
        path.resolve(import.meta.dirname, "attached_assets"),
        path.resolve(import.meta.dirname, "node_modules"),
      ],
      deny: ["**/.*"],
    },
  },
});
