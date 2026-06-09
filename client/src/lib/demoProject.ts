import { FileSystemNode } from "./neuralNodeTree";

/**
 * Generates a mock file system representing the actual Omnecor codebase
 * for demo purposes in the Neural Brain Map.
 */
export function generateOmnecorProjectMock(): FileSystemNode[] {
  const files: FileSystemNode[] = [
    // Root level folders
    { id: "dir-client", name: "client", type: "folder", path: "/client", metadata: { description: "Frontend React application code" } },
    { id: "dir-server", name: "server", type: "folder", path: "/server", metadata: { description: "Node.js/Express backend API" } },
    { id: "dir-shared", name: "shared", type: "folder", path: "/shared", metadata: { description: "Universal types and constants" } },
    { id: "dir-docs", name: "docs", type: "folder", path: "/docs", metadata: { description: "Project documentation and guides" } },
    { id: "dir-packaging", name: "packaging", type: "folder", path: "/packaging", metadata: { description: "Build scripts for Electron and Mobile" } },
    { id: "dir-scripts", name: "scripts", type: "folder", path: "/scripts", metadata: { description: "Utility and maintenance tools" } },

    // Client structure
    { id: "dir-client-src", name: "src", type: "folder", path: "/client/src", parent: "dir-client", metadata: { description: "React source components" } },
    { id: "file-client-app", name: "App.tsx", type: "file", path: "/client/src/App.tsx", parent: "dir-client-src", metadata: { description: "Main application router and shell" } },
    { id: "file-client-main", name: "main.tsx", type: "file", path: "/client/src/main.tsx", parent: "dir-client-src", metadata: { description: "React entry point and providers" } },
    { id: "dir-client-pages", name: "pages", type: "folder", path: "/client/src/pages", parent: "dir-client-src", metadata: { description: "Top-level route components" } },
    { id: "file-page-chat", name: "Chat.tsx", type: "file", path: "/client/src/pages/Chat.tsx", parent: "dir-client-pages", metadata: { description: "AI conversation workspace" } },
    { id: "file-page-brainmap", name: "BrainMap.tsx", type: "file", path: "/client/src/pages/BrainMap.tsx", parent: "dir-client-pages", metadata: { description: "Neural network visualization" } },
    { id: "file-page-settings", name: "Settings.tsx", type: "file", path: "/client/src/pages/Settings.tsx", parent: "dir-client-pages", metadata: { description: "Global configuration hub" } },
    { id: "file-page-designer", name: "3DDesigner.tsx", type: "file", path: "/client/src/pages/3DDesigner.tsx", parent: "dir-client-pages", metadata: { description: "3D and PCB design workspace" } },
    
    // Components
    { id: "dir-client-components", name: "components", type: "folder", path: "/client/src/components", parent: "dir-client-src", metadata: { description: "Reusable UI primitives" } },
    { id: "file-comp-layout", name: "OmnecorDashboardLayout.tsx", type: "file", path: "/client/src/components/OmnecorDashboardLayout.tsx", parent: "dir-client-components", metadata: { description: "Main sidebar and nav structure" } },
    { id: "file-comp-interface", name: "ChatInterface.tsx", type: "file", path: "/client/src/components/ChatInterface.tsx", parent: "dir-client-components", metadata: { description: "AI message rendering logic" } },

    // Server structure
    { id: "dir-server-core", name: "_core", type: "folder", path: "/server/_core", parent: "dir-server", metadata: { description: "Core Express/tRPC initialization" } },
    { id: "file-server-index", name: "index.ts", type: "file", path: "/server/_core/index.ts", parent: "dir-server-core", metadata: { description: "Backend bootstrap entry point" } },
    { id: "file-server-db", name: "db.ts", type: "file", path: "/server/db.ts", parent: "dir-server", metadata: { description: "Database schema and factory" } },
    { id: "dir-server-routers", name: "routers", type: "folder", path: "/server/routers", parent: "dir-server", metadata: { description: "tRPC API endpoint definitions" } },

    // Shared
    { id: "file-shared-types", name: "types.ts", type: "file", path: "/shared/types.ts", parent: "dir-shared", metadata: { description: "Common TypeScript interfaces" } },
    { id: "file-shared-const", name: "const.ts", type: "file", path: "/shared/const.ts", parent: "dir-shared", metadata: { description: "Global constants and flags" } },

    // Root files
    { id: "file-root-readme", name: "README.md", type: "file", path: "/README.md", metadata: { description: "Project documentation overview" } },
    { id: "file-root-package", name: "package.json", type: "file", path: "/package.json", metadata: { description: "Project dependencies and scripts" } },
    { id: "file-root-vite", name: "vite.config.ts", type: "file", path: "/vite.config.ts", metadata: { description: "Frontend build configuration" } },
    { id: "file-root-roadmap", name: "ROADMAP.md", type: "file", path: "/ROADMAP.md", metadata: { description: "Planned features and milestones" } },
  ];

  return files;
}
