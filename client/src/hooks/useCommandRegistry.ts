/**
 * @file client/src/hooks/useCommandRegistry.ts
 * @description Phase 18 — Dynamic command registry for the Command Palette.
 *
 * Returns a flat array of command descriptors. Groups: Navigation, Actions,
 * AI, Security, Hardware, Admin. Mutations are wired to live tRPC procedures.
 */

import { useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app.store";
import { trpc } from "@/lib/trpc";

export interface CommandEntry {
  id: string;
  label: string;
  description: string;
  group: "Navigation" | "Actions" | "AI" | "Security" | "Hardware" | "Admin";
  /** action is called with the palette already closed */
  action: () => void;
}

export function useCommandRegistry(): CommandEntry[] {
  const [, setLocation] = useLocation();
  const { clearConversation, setExecutionMode } = useAppStore();

  // ── tRPC mutations ────────────────────────────────────────────────────────
  const createSessionMut = trpc.ai.createSession.useMutation({
    onSuccess: ({ sessionId }) => {
      toast.success(`Session created: ${sessionId.slice(0, 8)}…`);
      setLocation("/chat");
    },
    onError: (err) => toast.error(`Failed to create session: ${err.message}`),
  });

  const setModeMut = trpc.system.setExecutionMode.useMutation({
    onSuccess: ({ mode }) =>
      toast.success(`Execution mode → ${mode.replace("_", " ")}`),
    onError: (err) => toast.error(`Mode switch failed: ${err.message}`),
  });

  const pullModelMut = trpc.ollama.pullModel.useMutation({
    onSuccess: ({ name }) =>
      toast.info(`Pulling Ollama model "${name}" in the background…`),
    onError: (err) => toast.error(`Pull failed: ${err.message}`),
  });

  const scanDirMut = trpc.security.scanDirectory.useMutation({
    onSuccess: (result) =>
      toast.info(
        `YARA scan complete — ${result.totalFiles} files, ${result.threatsFound} threat(s) found.`
      ),
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });

  const vulnScanMut = trpc.security.runVulnerabilityScan.useMutation({
    onSuccess: (result) =>
      toast.info(`Vulnerability scan complete — ${result?.findings?.length ?? 0} finding(s).`),
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });

  // ── Blender status query (lazy — refetch on demand) ───────────────────────
  const blenderStatusQuery = trpc.blender.status.useQuery(undefined, {
    enabled: false,
  });

  // ── Action helpers ────────────────────────────────────────────────────────
  const navigate = useCallback(
    (path: string) => setLocation(path),
    [setLocation]
  );

  const handleNewConversation = useCallback(() => {
    createSessionMut.mutate({
      projectId: "default",
      title: `Chat ${new Date().toLocaleTimeString()}`,
      providerId: "ollama",
      modelId: "llama3",
    });
  }, [createSessionMut]);

  const handleClearContext = useCallback(() => {
    clearConversation();
    toast.success("Conversation context cleared.");
  }, [clearConversation]);

  const handleConnectBlender = useCallback(async () => {
    const result = await blenderStatusQuery.refetch();
    const status = result.data as { isInstalled: boolean; version: string | null } | undefined;
    if (status?.isInstalled) {
      toast.success(`Blender ${status.version ?? ""} is connected.`);
      navigate("/integrations");
    } else {
      toast.info(
        "Blender not detected. Launch hint: install blender and ensure it is on your PATH."
      );
    }
  }, [blenderStatusQuery, navigate]);

  const handleFlashFirmware = useCallback(() => {
    // Navigate to integrations tab where ESP module lives
    navigate("/integrations");
    toast.info("ESP firmware flash module opened in Integrations.");
  }, [navigate]);

  const handleYaraScan = useCallback(() => {
    const projectRoot =
      import.meta.env.VITE_PROJECT_ROOT ??
      "/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1";
    toast.info("Starting YARA scan on project root…");
    scanDirMut.mutate({ dirPath: projectRoot });
  }, [scanDirMut]);

  const handleSetMode = useCallback(
    (mode: "sovereign" | "scrapper" | "big_spender") => {
      setExecutionMode(mode);
      setModeMut.mutate({ mode });
    },
    [setExecutionMode, setModeMut]
  );

  const handlePullOllamaModel = useCallback(() => {
    const modelName = window.prompt(
      "Enter Ollama model name to pull (e.g. llama3, mistral, phi3):",
      "llama3"
    );
    if (!modelName?.trim()) return;
    pullModelMut.mutate({ name: modelName.trim() });
  }, [pullModelMut]);

  // ── Registry ──────────────────────────────────────────────────────────────
  const commands: CommandEntry[] = [
    // Navigation
    {
      id: "nav-dashboard",
      label: "Dashboard",
      description: "Go to the main dashboard",
      group: "Navigation",
      action: () => navigate("/"),
    },
    {
      id: "nav-chat",
      label: "Chat",
      description: "Open the AI chat interface",
      group: "Navigation",
      action: () => navigate("/chat"),
    },
    {
      id: "nav-brain-map",
      label: "Neural Brain Map",
      description: "Visualise the neural knowledge graph",
      group: "Navigation",
      action: () => navigate("/brain-map"),
    },
    {
      id: "nav-model-hub",
      label: "Model Hub",
      description: "Browse and manage AI models",
      group: "Navigation",
      action: () => navigate("/model-hub"),
    },
    {
      id: "nav-pipelines",
      label: "Pipelines",
      description: "View and manage processing pipelines",
      group: "Navigation",
      action: () => navigate("/pipelines"),
    },
    {
      id: "nav-integrations",
      label: "Integrations",
      description: "Manage external service integrations",
      group: "Navigation",
      action: () => navigate("/integrations"),
    },
    {
      id: "nav-settings",
      label: "Settings",
      description: "Open application settings",
      group: "Navigation",
      action: () => navigate("/settings"),
    },

    // Actions
    {
      id: "action-new-conversation",
      label: "New Conversation",
      description: "Create a new AI chat session and navigate to /chat",
      group: "Actions",
      action: handleNewConversation,
    },
    {
      id: "action-clear-context",
      label: "Clear Context",
      description: "Clear the current conversation context from the store",
      group: "Actions",
      action: handleClearContext,
    },

    // AI — execution mode switching
    {
      id: "ai-mode-sovereign",
      label: "Switch to Sovereign Mode",
      description: "Use only local models — no cloud API calls",
      group: "AI",
      action: () => handleSetMode("sovereign"),
    },
    {
      id: "ai-mode-scrapper",
      label: "Switch to Scrapper Mode",
      description: "Balanced mode — prefer local, fall back to cheap cloud",
      group: "AI",
      action: () => handleSetMode("scrapper"),
    },
    {
      id: "ai-mode-big-spender",
      label: "Switch to Big Spender Mode",
      description: "Use the most capable cloud models without cost restriction",
      group: "AI",
      action: () => handleSetMode("big_spender"),
    },

    // AI — Ollama
    {
      id: "ai-pull-ollama-model",
      label: "Pull Ollama Model",
      description: "Download a model from the Ollama registry",
      group: "AI",
      action: handlePullOllamaModel,
    },

    // Security
    {
      id: "security-yara-scan",
      label: "Run YARA Scan",
      description: "Scan the project root directory for security threats",
      group: "Security",
      action: handleYaraScan,
    },
    {
      id: "security-vuln-scan",
      label: "Security Scan",
      description: "Run vulnerability + YARA combined scan on current directory",
      group: "Security",
      action: () => {
        const projectRoot =
          import.meta.env.VITE_PROJECT_ROOT ??
          "/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1";
        toast.info("Starting vulnerability scan…");
        vulnScanMut?.mutate?.({ targetPath: projectRoot });
      },
    },

    // Hardware
    {
      id: "hardware-connect-blender",
      label: "Connect Blender",
      description: "Check Blender installation status and open the module",
      group: "Hardware",
      action: handleConnectBlender,
    },
    {
      id: "hardware-flash-firmware",
      label: "Flash Firmware",
      description: "Open the ESP firmware flash module",
      group: "Hardware",
      action: handleFlashFirmware,
    },

    // Admin (always included — CommandPalette filters by role)
    {
      id: "admin-audit-log",
      label: "Audit Log",
      description: "View the system audit log",
      group: "Admin",
      action: () => navigate("/settings?tab=admin"),
    },
    {
      id: "admin-user-management",
      label: "User Management",
      description: "Manage users and roles",
      group: "Admin",
      action: () => navigate("/settings?tab=admin"),
    },
  ];

  return commands;
}
