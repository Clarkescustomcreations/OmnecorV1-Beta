export type NeuralMapMode =
  | "standard"
  | "fiction"
  | "research"
  | "coding"
  | "roleplay";

export interface CloudProviderConfig {
  provider: "google-drive" | "dropbox" | "onedrive" | "s3";
  rootPath: string;
  authRef: string;
}

export interface ProjectPeerCard {
  description?: string;
  techStack?: string[];
  goals?: string[];
  team?: string[];
  notes?: string;
}

export interface NeuralBrainMap {
  id: string;
  name: string;
  mode: NeuralMapMode;
  rootDirectories: string[];
  cloudProviders?: CloudProviderConfig[];
  projectContext?: ProjectPeerCard;
  labelOverrides?: Record<string, string>;
  settings: {
    autoWatch: boolean;
    realtimeSync: boolean;
    indexingEnabled: boolean;
    graphPhysics: boolean;
    maxDepth: number;
    isolateMemory: boolean;
    enableAIContext: boolean;
    enableSemanticLinks: boolean;
    collapsedFolderIds?: string[];
    layoutPrefs?: {
      layout?: string;
      nodeSize?: number;
      simSpeed?: number;
      gpuEnabled?: boolean;
      autoClustering?: boolean;
    };
    fictionState?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FileEvent {
  eventType: "add" | "addDir" | "change" | "unlink" | "unlinkDir";
  relativePath: string;
  size?: number;
  extension?: string;
  timestamp: string;
}
