import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  PlusCircle,
  MessageSquare,
  Trash2,
  Edit2,
  Search,
  ChevronLeft,
  ChevronRight,
  Code2,
  FolderOpen,
  History,
  Terminal,
  MoreVertical,
} from "lucide-react";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import { cn } from "@/lib/utils";
import type { StoredConversationMeta } from "@/lib/chatContext";
import type { SavedScript } from "@/lib/scriptStorage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConversationListProps {
  conversations: StoredConversationMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;

  // Filter scope toggling
  filterScope?: "project" | "global";
  onFilterScopeChange?: (scope: "project" | "global") => void;

  // Script management
  scripts?: SavedScript[];
  onSelectScript?: (script: SavedScript) => void;
  onDeleteScript?: (id: number) => void;
  onRenameScript?: (id: number, name: string) => void;
}

function timeAgo(iso: string | Date): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  collapsed,
  onToggleCollapse,
  filterScope = "project",
  onFilterScopeChange,
  scripts = [],
  onSelectScript,
  onDeleteScript,
  onRenameScript,
}: ConversationListProps) {
  const [mode, setMode] = useState<"chats" | "scripts">("chats");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortByProject, setSortByProject] = useState(false);

  const filteredConversations = conversations.filter(
    c =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  const filteredScripts = useMemo(() => {
    let filtered = scripts.filter(
      s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.project.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
    );

    if (sortByProject) {
      filtered = [...filtered].sort((a, b) => a.project.localeCompare(b.project));
    }

    return filtered;
  }, [scripts, search, sortByProject]);

  const startEdit = (id: string | number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(String(id));
    setEditValue(title);
  };

  const confirmEdit = () => {
    if (editingId && editValue.trim()) {
      if (mode === "chats") {
        onRename(editingId, editValue.trim());
      } else {
        onRenameScript?.(Number(editingId), editValue.trim());
      }
    }
    setEditingId(null);
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-10 border-r border-border py-2 bg-card/50 flex-shrink-0">
        <HowToTooltip title="Expand Sidebar" description="Show your conversation history and chat management." side="right">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onToggleCollapse}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </HowToTooltip>
        <div className="w-full h-px bg-border my-0.5" />
        <Button
          size="icon"
          variant={mode === "chats" ? "secondary" : "ghost"}
          className="h-7 w-7"
          onClick={() => setMode("chats")}
          title="Chats"
        >
          <History className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant={mode === "scripts" ? "secondary" : "ghost"}
          className="h-7 w-7"
          onClick={() => setMode("scripts")}
          title="Saved Scripts"
        >
          <Code2 className="w-4 h-4" />
        </Button>
        <div className="w-full h-px bg-border my-0.5" />
        {mode === "chats" ? (
          conversations.slice(0, 8).map(c => (
            <Button
              key={c.id}
              size="icon"
              variant={c.id === activeId ? "secondary" : "ghost"}
              onClick={() => onSelect(c.id)}
              title={c.title}
              className="h-7 w-7"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          ))
        ) : (
          scripts.slice(0, 8).map(s => (
            <Button
              key={s.id}
              size="icon"
              variant="ghost"
              onClick={() => onSelectScript?.(s)}
              title={s.name}
              className="h-7 w-7"
            >
              <Terminal className="w-3.5 h-3.5" />
            </Button>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-64 border-r border-border bg-card/50 flex-shrink-0">
      {/* Header & Mode Toggle */}
      <div className="flex flex-col gap-2 p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex bg-muted/50 p-0.5 rounded-lg border border-border/50">
            <button
              onClick={() => setMode("chats")}
              className={cn(
                "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                mode === "chats"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Chats
            </button>
            <button
              onClick={() => setMode("scripts")}
              className={cn(
                "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                mode === "scripts"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Scripts
            </button>
          </div>

          <div className="flex items-center gap-0.5">
            {mode === "chats" && (
              <HowToTooltip title="New Conversation" description="Start a fresh chat session." side="left">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={onCreate}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                </Button>
              </HowToTooltip>
            )}
            {mode === "scripts" && (
              <HowToTooltip title="Group by Project" description="Organise scripts into project folders." side="left">
                <Button
                  size="icon"
                  variant={sortByProject ? "secondary" : "ghost"}
                  className="h-6 w-6"
                  onClick={() => setSortByProject(!sortByProject)}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </HowToTooltip>
            )}
            <HowToTooltip title="Collapse Sidebar" description="Hide the conversation list to free up space." side="left">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={onToggleCollapse}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </HowToTooltip>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={mode === "chats" ? "Search conversations..." : "Search scripts & projects..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 pl-6 pr-2 text-xs bg-muted/30"
          />
        </div>

        {/* Scope selector (Project vs Global) */}
        {mode === "chats" && onFilterScopeChange && (
          <div className="flex bg-muted/30 p-0.5 rounded-md border border-border/40 w-full mt-1.5 flex-shrink-0">
            <button
              onClick={() => onFilterScopeChange("project")}
              className={cn(
                "flex-1 text-center py-1 text-[9px] font-bold uppercase tracking-wider rounded-sm transition-all cursor-pointer",
                filterScope === "project"
                  ? "bg-primary text-primary-foreground shadow-xs animate-in fade-in duration-100"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Project
            </button>
            <button
              onClick={() => onFilterScopeChange("global")}
              className={cn(
                "flex-1 text-center py-1 text-[9px] font-bold uppercase tracking-wider rounded-sm transition-all cursor-pointer",
                filterScope === "global"
                  ? "bg-primary text-primary-foreground shadow-xs animate-in fade-in duration-100"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Global
            </button>
          </div>
        )}
      </div>

      {/* List Area */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-2 px-2 space-y-0.5">
          {mode === "chats" ? (
            filteredConversations.length === 0 ? (
              <div className="px-2 py-8 text-xs text-muted-foreground text-center italic">
                {search ? "No conversations match your search" : "No history yet"}
              </div>
            ) : (
              filteredConversations.map(conv => (
                <div
                  key={conv.id}
                  className={cn(
                    "group relative flex flex-col gap-0.5 px-2.5 py-2 cursor-pointer rounded-lg transition-all",
                    conv.id === activeId
                      ? "bg-primary/40 text-foreground shadow-sm font-semibold"
                      : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => onSelect(conv.id)}
                >
                  {editingId === conv.id ? (
                    <Input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={confirmEdit}
                      onKeyDown={e => {
                        if (e.key === "Enter") confirmEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-5 text-xs py-0 px-1"
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <MessageSquare className={cn("w-3 h-3", conv.id === activeId ? "text-primary" : "text-muted-foreground/50")} />
                      <span className="text-xs font-medium truncate flex-1">
                        {conv.title}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 ml-5">
                    <span className="text-[10px] opacity-60">
                      {timeAgo(conv.updatedAt)}
                    </span>
                    {conv.messageCount > 0 && (
                      <span className="text-[10px] opacity-60">
                        · {conv.messageCount} msgs
                      </span>
                    )}
                  </div>

                  {/* Hover actions */}
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-background/90 backdrop-blur-sm rounded-md border border-border/50 p-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={e => startEdit(conv.id, conv.title, e)}
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 hover:text-destructive"
                      onClick={e => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </Button>
                  </div>
                </div>
              ))
            )
          ) : (
            /* Scripts View */
            filteredScripts.length === 0 ? (
              <div className="px-2 py-8 text-xs text-muted-foreground text-center italic">
                {search ? "No scripts found" : "No saved scripts yet"}
              </div>
            ) : (
              filteredScripts.map(script => (
                <div
                  key={script.id}
                  className="group relative flex flex-col gap-1 px-2.5 py-2 cursor-pointer rounded-lg hover:bg-muted/50 transition-all border border-transparent hover:border-border/50"
                  onClick={() => onSelectScript?.(script)}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center mt-0.5">
                      <Terminal className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingId === String(script.id) ? (
                        <Input
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={confirmEdit}
                          onKeyDown={e => {
                            if (e.key === "Enter") confirmEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-5 text-xs py-0 px-1"
                          autoFocus
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-xs font-semibold text-foreground truncate block">
                          {script.name}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="secondary" className="text-[9px] px-1 h-3.5 bg-primary/5 text-primary/80 border-primary/20">
                          {script.project || "Default"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground opacity-60">
                          {timeAgo(script.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Hover actions */}
                  <div className="absolute right-1.5 top-2 hidden group-hover:flex items-center gap-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 bg-background/80 backdrop-blur-sm border border-border/50"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreVertical className="w-2.5 h-2.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={e => startEdit(script.id, script.name, e)}>
                          <Edit2 className="w-3 h-3 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={e => {
                            e.stopPropagation();
                            onDeleteScript?.(script.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
