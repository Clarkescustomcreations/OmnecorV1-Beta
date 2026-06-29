import fs from "fs/promises";
import path from "path";
import { getSetting, setSetting } from "./SettingsService.js";
import { createLogger } from "../../_core/logger.js";
import { validatePath, assertOutboundUrlAllowed } from "../../_core/security.js";

const log = createLogger("PenpotService");

/** A React component name must be a plain PascalCase-style identifier. This
 *  doubles as the output filename, so rejecting anything else also blocks path
 *  traversal via the component name. */
const COMPONENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface PenpotConfig {
  url: string;
  token: string;
}

export interface PenpotNode {
  id: string;
  type: string;
  name: string;
  children?: PenpotNode[];
  // Additional shape data depending on what Penpot API returns
  [key: string]: any;
}

export class PenpotService {
  private static instance: PenpotService | null = null;

  static getInstance(): PenpotService {
    if (!PenpotService.instance) {
      PenpotService.instance = new PenpotService();
    }
    return PenpotService.instance;
  }

  private getConfig(): PenpotConfig {
    const url = getSetting<string>("penpotUrl", "https://design.penpot.app");
    const token = getSetting<string>("penpotToken", "");
    return { url, token };
  }

  /**
   * Ensure credentials are saved in settings
   */
  async configure(url: string, token: string) {
    // Reject SSRF-prone endpoints (cloud metadata / link-local) before storing.
    await assertOutboundUrlAllowed(url);
    await setSetting("penpotUrl", url);
    await setSetting("penpotToken", token);
    log.info(`Penpot configured for ${url}`);
  }

  /**
   * Fetches a Penpot file by its ID
   */
  async fetchFile(fileId: string): Promise<any> {
    const config = this.getConfig();
    if (!config.token) {
      throw new Error("Penpot API token is not configured.");
    }

    // Re-validate at use time (the stored setting could have been changed since
    // configure()), so the auth token is never sent to an SSRF target.
    await assertOutboundUrlAllowed(config.url);

    // Encode the id so it can't inject extra query params or path segments.
    const endpoint = `${config.url.replace(/\/$/, '')}/api/rpc/command/get-file?id=${encodeURIComponent(fileId)}`;

    log.info(`Fetching Penpot file: ${fileId}`);
    const response = await fetch(endpoint, {
      method: "GET",
      // Don't follow redirects — a 3xx to an internal host would bypass the
      // SSRF check above and leak the auth token.
      redirect: "error",
      headers: {
        "Authorization": `Token ${config.token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Penpot file: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Basic translation engine: Maps Penpot JSON node hierarchy to a React component string.
   * This is a scaffold that will grow as the internal Penpot schema mapping evolves.
   */
  private translateToReact(node: PenpotNode, componentName: string): string {
    // Scaffold implementation
    // A real implementation would recursively walk 'node' and apply mapping to our Context/UI-Tokens.md
    
    return `import React from 'react';
import { cn } from '@/lib/utils';

export interface ${componentName}Props {
  className?: string;
}

/**
 * Auto-generated from Penpot Design
 * Node: ${node.name || 'Unknown'} (${node.id})
 */
export const ${componentName}: React.FC<${componentName}Props> = ({ className }) => {
  return (
    <div className={cn("flex flex-col bg-card text-card-foreground p-4 rounded-lg shadow-sm", className)}>
      <h2 className="text-xl font-semibold text-foreground">{node.name || "Penpot Component"}</h2>
      {/* TODO: Implement full recursive child rendering based on Penpot API schema */}
    </div>
  );
};
`;
  }

  /**
   * Fetches a Penpot file and generates a React component in the local workspace.
   */
  async generateComponent(fileId: string, nodeId: string, componentName: string, outputDir: string = "client/src/components/generated"): Promise<string> {
    if (!COMPONENT_NAME_RE.test(componentName)) {
      throw new Error(
        `Invalid component name "${componentName}": must be a valid identifier (letters, digits, underscore; starting with a letter).`,
      );
    }
    try {
      const fileData = await this.fetchFile(fileId);
      
      // In Penpot API, file data contains pages and objects.
      // We need to find the specific node. For scaffolding, we mock finding it.
      // let targetNode = findNodeInPenpotTree(fileData, nodeId);
      const targetNode: PenpotNode = { id: nodeId, type: "board", name: componentName }; // Mocking for now

      if (!targetNode) {
        throw new Error(`Node ${nodeId} not found in Penpot file ${fileId}`);
      }

      const reactCode = this.translateToReact(targetNode, componentName);

      // Write to workspace safely
      const safeOutputDir = await validatePath(outputDir);
      await fs.mkdir(safeOutputDir, { recursive: true });

      // Re-validate the final path: componentName is already an identifier, but
      // confirm the joined path still resolves inside the validated directory.
      const filePath = await validatePath(
        path.join(safeOutputDir, `${componentName}.tsx`),
        safeOutputDir,
      );
      await fs.writeFile(filePath, reactCode, "utf-8");
      
      log.info(`Generated React component ${componentName} at ${filePath}`);
      return filePath;
    } catch (error) {
      log.error(`Failed to generate component from Penpot`, error);
      throw error;
    }
  }
}
