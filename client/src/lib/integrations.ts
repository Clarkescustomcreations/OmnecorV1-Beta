/**
 * Third-Party Integrations Hub
 *
 * Manages OAuth-based account linking for:
 * - GitHub (repositories, code integration)
 * - Notion (knowledge base, documentation)
 * - Slack (team communication, notifications)
 * - Cloud Storage (Google Drive, Dropbox, OneDrive)
 * - Generic OAuth Providers (custom API integrations)
 */

export type IntegrationType =
  | "github"
  | "notion"
  | "slack"
  | "google-drive"
  | "dropbox"
  | "onedrive"
  | "outlook"
  | "gmail"
  | "generic";

/** Which Omnecor features each integration can power */
export const INTEGRATION_FEATURES: Record<IntegrationType, string[]> = {
  github:       ["chat", "neural-map"],
  notion:       ["chat"],
  slack:        ["chat"],
  "google-drive": ["chat"],
  dropbox:      ["chat"],
  onedrive:     ["chat"],
  outlook:      ["chat", "neural-map", "agent-networking"],
  gmail:        ["chat", "neural-map", "agent-networking"],
  generic:      ["chat"],
};

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
  authorizationUrl: string;
  tokenUrl: string;
}

export interface OAuthToken {
  id: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scope: string[];
}

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  description: string;
  isConnected: boolean;
  account?: {
    username: string;
    email?: string;
    avatar?: string;
    id: string;
  };
  token?: OAuthToken;
  lastSynced?: Date;
  syncStatus: "idle" | "syncing" | "success" | "error";
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationAction {
  id: string;
  integrationId: string;
  type: string; // e.g., "sync", "import", "export"
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number; // 0-100
  result?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface GitHubIntegration extends Integration {
  type: "github";
  repositories?: {
    id: number;
    name: string;
    url: string;
    description?: string;
    isPrivate: boolean;
    lastPushed: Date;
  }[];
}

export interface NotionIntegration extends Integration {
  type: "notion";
  databases?: {
    id: string;
    title: string;
    icon?: string;
    itemCount: number;
  }[];
}

export interface SlackIntegration extends Integration {
  type: "slack";
  workspaces?: {
    id: string;
    name: string;
    icon?: string;
    channels: {
      id: string;
      name: string;
      isPrivate: boolean;
    }[];
  }[];
}

export interface CloudStorageIntegration extends Integration {
  type: "google-drive" | "dropbox" | "onedrive";
  storageQuota?: {
    used: number;
    total: number;
  };
  rootFolder?: {
    id: string;
    name: string;
  };
}

/**
 * Get integration display info
 */
export function getIntegrationInfo(type: IntegrationType) {
  const integrationInfo: Record<
    IntegrationType,
    {
      title: string;
      description: string;
      icon: string;
      color: string;
      scope: string[];
    }
  > = {
    github: {
      title: "GitHub",
      description: "Connect your GitHub account for repository management — use in Chat and Neural Map",
      icon: "🐙",
      color: "bg-slate-900",
      scope: ["repo", "user", "gist"],
    },
    notion: {
      title: "Notion",
      description: "Link your Notion workspace for knowledge base integration",
      icon: "📝",
      color: "bg-slate-800",
      scope: ["read", "write"],
    },
    slack: {
      title: "Slack",
      description: "Connect Slack for team communication and notifications",
      icon: "💬",
      color: "bg-purple-600",
      scope: ["chat:write", "channels:read", "users:read"],
    },
    "google-drive": {
      title: "Google Drive",
      description: "Sync files with Google Drive",
      icon: "☁️",
      color: "bg-blue-500",
      scope: ["drive"],
    },
    dropbox: {
      title: "Dropbox",
      description: "Sync files with Dropbox",
      icon: "📦",
      color: "bg-blue-600",
      scope: ["files.content.read", "files.content.write"],
    },
    onedrive: {
      title: "OneDrive",
      description: "Sync files with Microsoft OneDrive",
      icon: "☁️",
      color: "bg-blue-400",
      scope: ["Files.ReadWrite.All"],
    },
    outlook: {
      title: "Outlook",
      description: "Connect Outlook / Microsoft 365 email — use in Chat, Neural Map, and Agent Networking",
      icon: "📧",
      color: "bg-blue-700",
      scope: ["Mail.Read", "Mail.Send", "Calendars.Read"],
    },
    gmail: {
      title: "Gmail",
      description: "Connect your Gmail account — use in Chat, Neural Map, and Agent Networking",
      icon: "✉️",
      color: "bg-red-600",
      scope: ["gmail.readonly", "gmail.send"],
    },
    generic: {
      title: "Custom OAuth Provider",
      description: "Connect any OAuth-compatible service",
      icon: "🔌",
      color: "bg-gray-600",
      scope: [],
    },
  };

  return integrationInfo[type];
}

/**
 * Create an integration
 */
export function createIntegration(
  type: IntegrationType,
  name: string,
  description: string
): Integration {
  return {
    id: `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    name,
    description,
    isConnected: false,
    syncStatus: "idle",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Connect an integration
 */
export function connectIntegration(
  integration: Integration,
  account: { username: string; email?: string; avatar?: string; id: string },
  token: OAuthToken
): Integration {
  return {
    ...integration,
    isConnected: true,
    account,
    token,
    syncStatus: "success",
    updatedAt: new Date(),
  };
}

/**
 * Disconnect an integration
 */
export function disconnectIntegration(integration: Integration): Integration {
  return {
    ...integration,
    isConnected: false,
    account: undefined,
    token: undefined,
    syncStatus: "idle",
    updatedAt: new Date(),
  };
}

/**
 * Update sync status
 */
export function updateSyncStatus(
  integration: Integration,
  status: "idle" | "syncing" | "success" | "error",
  error?: string
): Integration {
  return {
    ...integration,
    syncStatus: status,
    error,
    lastSynced: status === "success" ? new Date() : integration.lastSynced,
    updatedAt: new Date(),
  };
}

/**
 * Create an integration action
 */
export function createIntegrationAction(
  integrationId: string,
  type: string
): IntegrationAction {
  return {
    id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    integrationId,
    type,
    status: "pending",
    progress: 0,
    createdAt: new Date(),
  };
}

/**
 * Update integration action
 */
export function updateIntegrationAction(
  action: IntegrationAction,
  status: "pending" | "in_progress" | "completed" | "failed",
  progress: number = 0,
  result?: Record<string, unknown>,
  error?: string
): IntegrationAction {
  return {
    ...action,
    status,
    progress,
    result,
    error,
    completedAt:
      status === "completed" || status === "failed" ? new Date() : undefined,
  };
}

/**
 * Create GitHub integration
 */
export function createGitHubIntegration(): GitHubIntegration {
  return {
    ...createIntegration("github", "GitHub", "Connect your GitHub account"),
    type: "github",
    repositories: [],
  };
}

/**
 * Create Notion integration
 */
export function createNotionIntegration(): NotionIntegration {
  return {
    ...createIntegration("notion", "Notion", "Link your Notion workspace"),
    type: "notion",
    databases: [],
  };
}

/**
 * Create Slack integration
 */
export function createSlackIntegration(): SlackIntegration {
  return {
    ...createIntegration("slack", "Slack", "Connect Slack workspace"),
    type: "slack",
    workspaces: [],
  };
}

/**
 * Create Cloud Storage integration
 */
export function createCloudStorageIntegration(
  type: "google-drive" | "dropbox" | "onedrive"
): CloudStorageIntegration {
  const info = getIntegrationInfo(type);
  return {
    ...createIntegration(type, info.title, info.description),
    type,
    storageQuota: { used: 0, total: 0 },
  };
}

/**
 * Mock GitHub integration
 */
export function createMockGitHubIntegration(): GitHubIntegration {
  const integration = createGitHubIntegration();
  const token: OAuthToken = {
    id: `token_${Date.now()}`,
    accessToken: "ghp_" + Math.random().toString(36).substr(2, 30),
    expiresAt: new Date(Date.now() + 3600000),
    tokenType: "bearer",
    scope: ["repo", "user", "gist"],
  };

  const connected = connectIntegration(
    integration,
    {
      username: "omnecor-user",
      email: "user@omnecor.ai",
      id: "user_123",
    },
    token
  );

  return {
    ...connected,
    type: "github",
    repositories: [
      {
        id: 1,
        name: "omnecor.ai-workstation",
        url: "https://github.com/omnecor/omnecor.ai-workstation",
        description: "The Ultimate All-in-One AI Workstation",
        isPrivate: false,
        lastPushed: new Date(Date.now() - 3600000),
      },
      {
        id: 2,
        name: "neural-map-visualizer",
        url: "https://github.com/omnecor/neural-map-visualizer",
        description:
          "Spatial neural network visualization and graph management",
        isPrivate: true,
        lastPushed: new Date(Date.now() - 86400000),
      },
    ],
  };
}

/**
 * Mock Notion integration
 */
export function createMockNotionIntegration(): NotionIntegration {
  const integration = createNotionIntegration();
  const token: OAuthToken = {
    id: `token_${Date.now()}`,
    accessToken: "secret_" + Math.random().toString(36).substr(2, 30),
    expiresAt: new Date(Date.now() + 7776000000), // 90 days
    tokenType: "bearer",
    scope: ["read", "write"],
  };

  const connected = connectIntegration(
    integration,
    {
      username: "omnecor-workspace",
      id: "workspace_123",
    },
    token
  );

  return {
    ...connected,
    type: "notion",
    databases: [
      {
        id: "db_1",
        title: "Project Plans",
        icon: "📋",
        itemCount: 12,
      },
      {
        id: "db_2",
        title: "Research Findings",
        icon: "🔬",
        itemCount: 45,
      },
    ],
  };
}

/**
 * Mock Slack integration
 */
export function createMockSlackIntegration(): SlackIntegration {
  const integration = createSlackIntegration();
  const token: OAuthToken = {
    id: `token_${Date.now()}`,
    accessToken: "xoxb-" + Math.random().toString(36).substr(2, 30),
    expiresAt: new Date(Date.now() + 7776000000),
    tokenType: "bearer",
    scope: ["chat:write", "channels:read", "users:read"],
  };

  const connected = connectIntegration(
    integration,
    {
      username: "omnecor-bot",
      id: "bot_123",
    },
    token
  );

  return {
    ...connected,
    type: "slack",
    workspaces: [
      {
        id: "ws_1",
        name: "Omnecor Team",
        icon: "🤖",
        channels: [
          { id: "ch_1", name: "general", isPrivate: false },
          { id: "ch_2", name: "ai-research", isPrivate: false },
          { id: "ch_3", name: "private-notes", isPrivate: true },
        ],
      },
    ],
  };
}

export interface OutlookIntegration extends Integration {
  type: "outlook";
  mailboxes?: {
    id: string;
    displayName: string;
    emailAddress: string;
    unreadCount: number;
  }[];
}

export interface GmailIntegration extends Integration {
  type: "gmail";
  labels?: {
    id: string;
    name: string;
    messagesTotal: number;
    messagesUnread: number;
  }[];
}

export function createOutlookIntegration(): OutlookIntegration {
  return {
    ...createIntegration("outlook", "Outlook", "Connect Outlook / Microsoft 365 email"),
    type: "outlook",
    mailboxes: [],
  };
}

export function createGmailIntegration(): GmailIntegration {
  return {
    ...createIntegration("gmail", "Gmail", "Connect your Gmail account"),
    type: "gmail",
    labels: [],
  };
}

/**
 * Mock Google Drive integration
 */
export function createMockGoogleDriveIntegration(): CloudStorageIntegration {
  const integration = createCloudStorageIntegration("google-drive");
  const token: OAuthToken = {
    id: `token_${Date.now()}`,
    accessToken: "ya29." + Math.random().toString(36).substr(2, 30),
    refreshToken: "1//" + Math.random().toString(36).substr(2, 30),
    expiresAt: new Date(Date.now() + 3600000),
    tokenType: "bearer",
    scope: ["drive"],
  };

  const connected = connectIntegration(
    integration,
    {
      username: "omnecor.user@gmail.com",
      email: "omnecor.user@gmail.com",
      id: "user_goog_123",
    },
    token
  );

  return {
    ...connected,
    type: "google-drive",
    storageQuota: {
      used: 15 * 1024 * 1024 * 1024, // 15 GB
      total: 100 * 1024 * 1024 * 1024, // 100 GB
    },
    rootFolder: {
      id: "root",
      name: "My Drive",
    },
  };
}
