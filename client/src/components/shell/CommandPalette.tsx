import React, { useEffect } from "react";
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
  Search,
  Plus,
  Trash2,
  Cpu,
  Terminal,
  FileCode,
  File,
  Monitor,
} from "lucide-react";
import { useAppStore } from "@/lib/store/app.store";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function CommandPalette() {
  const { 
    commandPaletteOpen: open, 
    setCommandPaletteOpen: setOpen,
    toggleCommandPalette,
    fileHistory 
  } = useAppStore();
  const [, setLocation] = useLocation();

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

  const navigate = (path: string) => {
    runCommand(() => setLocation(path));
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => navigate("/")}>
            <Monitor className="mr-2 h-4 w-4" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => navigate("/chat")}>
            <MessageCircle className="mr-2 h-4 w-4" />
            Chat
          </CommandItem>
          <CommandItem onSelect={() => navigate("/brain-map")}>
            <Brain className="mr-2 h-4 w-4" />
            Neural Brain Map
          </CommandItem>
          <CommandItem onSelect={() => navigate("/model-hub")}>
            <Zap className="mr-2 h-4 w-4" />
            Model Hub
          </CommandItem>
          <CommandItem onSelect={() => navigate("/pipelines")}>
            <GitBranch className="mr-2 h-4 w-4" />
            Pipelines
          </CommandItem>
          <CommandItem onSelect={() => navigate("/integrations")}>
            <Plug className="mr-2 h-4 w-4" />
            Integrations
          </CommandItem>
          <CommandItem onSelect={() => navigate("/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>
        
        <CommandSeparator />
        
        <CommandGroup heading="AI Actions">
          <CommandItem onSelect={() => runCommand(() => {
            toast.info("New conversation started");
            // Logic for new conversation would go here
          })}>
            <Plus className="mr-2 h-4 w-4" />
            New Conversation
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => {
            toast.info("Context cleared");
          })}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear Context
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Hardware">
          <CommandItem onSelect={() => runCommand(() => {
            toast.info("Connecting to Blender...");
          })}>
            <Cpu className="mr-2 h-4 w-4" />
            Connect Blender
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => {
            toast.info("Opening Serial Monitor...");
          })}>
            <Terminal className="mr-2 h-4 w-4" />
            Open Serial Monitor
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => {
            toast.info("Starting Firmware Flash...");
          })}>
            <FileCode className="mr-2 h-4 w-4" />
            Flash Firmware
          </CommandItem>
        </CommandGroup>

        {fileHistory.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Files">
              {fileHistory.map((path) => (
                <CommandItem key={path} onSelect={() => navigate(`/editor?path=${encodeURIComponent(path)}`)}>
                  <File className="mr-2 h-4 w-4" />
                  {path.split('/').pop()}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
