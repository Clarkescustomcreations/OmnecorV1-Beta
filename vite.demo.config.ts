import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
