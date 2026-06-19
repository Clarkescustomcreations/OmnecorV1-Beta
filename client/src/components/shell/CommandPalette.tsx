/**
 * @file client/src/components/shell/CommandPalette.tsx
 * @description Phase 18 — Command Palette with fully wired dynamic command registry.
 *
 * Commands are sourced from useCommandRegistry (tRPC mutations, Zustand actions,
 * wouter navigation). cmdk fuzzy search is driven by descriptive `value` props.
 */

import React, { useEffect, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useLocation } from "wouter";
import {
  Brain,
  MessageCircle,
  Zap,
  GitBranch,
  Plug,
  Settings,
  Plus,
  Trash2,
  Cpu,
  Terminal,
  FileCode,
  File,
  Monitor,
  Activity,
  Users,
  Shield,
  Download,
  Globe,
  Swords,
  Coins,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app.store";
import { trpc } from "@/lib/trpc";
import { useCommandRegistry, type CommandEntry } from "@/hooks/useCommandRegistry";

// Map group names to section icons (fallback only — individual commands provide their own)
const GROUP_ORDER = ["Navigation", "Actions", "Workflows", "AI", "Security", "Hardware", "Admin"] as const;

/** Pick an icon for a command based on its id. Falls back to a generic one. */
function iconForCommand(cmd: CommandEntry): React.ReactNode {
  const cls = "mr-2 h-4 w-4";
  switch (cmd.id) {
    // Navigation
    case "nav-dashboard":          return <Monitor className={cls} />;
    case "nav-chat":               return <MessageCircle className={cls} />;
    case "nav-brain-map":          return <Brain className={cls} />;
    case "nav-model-hub":          return <Zap className={cls} />;
    case "nav-pipelines":          return <GitBranch className={cls} />;
    case "nav-integrations":       return <Plug className={cls} />;
    case "nav-settings":           return <Settings className={cls} />;

    // Actions
    case "action-new-conversation": return <Plus className={cls} />;
    case "action-clear-context":    return <Trash2 className={cls} />;

    // AI
    case "ai-mode-sovereign":      return <Globe className={cls} />;
    case "ai-mode-scrapper":       return <Swords className={cls} />;
    case "ai-mode-big-spender":    return <Coins className={cls} />;
    case "ai-pull-ollama-model":   return <Download className={cls} />;

    // Security
    case "security-yara-scan":     return <Shield className={cls} />;

    // Hardware
    case "hardware-connect-blender": return <Cpu className={cls} />;
    case "hardware-flash-firmware":  return <FileCode className={cls} />;

    // Admin
    case "admin-audit-log":        return <Activity className={cls} />;
    case "admin-user-management":  return <Users className={cls} />;

    default:                       return <Terminal className={cls} />;
  }
}

export function CommandPalette() {
  const {
    commandPaletteOpen: open,
    setCommandPaletteOpen: setOpen,
    toggleCommandPalette,
    fileHistory,
  } = useAppStore();
  const [, setLocation] = useLocation();
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  // Dynamic command registry
  const allCommands = useCommandRegistry();

  // Filter admin commands based on role
  const visibleCommands = useMemo(
    () => allCommands.filter((c) => c.group !== "Admin" || isAdmin),
    [allCommands, isAdmin]
  );

  // Group commands for rendering
  const grouped = useMemo(() => {
    const map = new Map<string, CommandEntry[]>();
    for (const group of GROUP_ORDER) {
      const entries = visibleCommands.filter((c) => c.group === group);
      if (entries.length > 0) map.set(group, entries);
    }
    return map;
  }, [visibleCommands]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggleCommandPalette]);

  const runCommand = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Dynamic registry groups */}
        {Array.from(grouped.entries()).map(([group, cmds], groupIdx) => (
          <React.Fragment key={group}>
            {groupIdx > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {cmds.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={`${cmd.label} ${cmd.description} ${cmd.group}`}
                  onSelect={() => runCommand(cmd.action)}
                >
                  {iconForCommand(cmd)}
                  <span>{cmd.label}</span>
                  {cmd.description && (
                    <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                      — {cmd.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}

        {/* Recent Files — driven by store, not the registry */}
        {fileHistory.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Files">
              {fileHistory.map((path) => (
                <CommandItem
                  key={path}
                  value={`recent file ${path}`}
                  onSelect={() =>
                    runCommand(() =>
                      setLocation(
                        `/editor?path=${encodeURIComponent(path)}`
                      )
                    )
                  }
                >
                  <File className="mr-2 h-4 w-4" />
                  {path.split("/").pop()}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
