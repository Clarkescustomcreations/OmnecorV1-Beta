import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PlusCircle,
  MessageSquare,
  Trash2,
  Edit2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredConversationMeta } from "@/lib/chatContext";

interface ConversationListProps {
  conversations: StoredConversationMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  collapsed,
  onToggleCollapse,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const filtered = conversations.filter(
    c =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = (conv: StoredConversationMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const confirmEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-10 border-r border-border py-2 bg-card/50 flex-shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onToggleCollapse}
          title="Expand conversations"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onCreate}
          title="New conversation"
        >
          <PlusCircle className="w-3.5 h-3.5" />
        </Button>
        <div className="w-full h-px bg-border my-0.5" />
        {conversations.slice(0, 12).map(c => (
          <Button
            key={c.id}
            size="icon"
            variant={c.id === activeId ? "secondary" : "ghost"}
            onClick={() => onSelect(c.id)}
            title={c.title}
            className="h-7 w-7"
          >
            <MessageSquare className="w-3 h-3" />
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-60 border-r border-border bg-card/50 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Chats
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onCreate}
            title="New conversation"
          >
            <PlusCircle className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 pl-6 pr-2 text-xs"
          />
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="py-1 px-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-xs text-muted-foreground text-center">
              {search ? "No matches" : "No conversations yet"}
            </div>
          ) : (
            filtered.map(conv => (
              <div
                key={conv.id}
                className={cn(
                  "group relative flex flex-col gap-0.5 px-2 py-1.5 cursor-pointer rounded-md hover:bg-accent/30 transition-colors",
                  conv.id === activeId && "bg-accent/40 hover:bg-accent/50"
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
                  <span className="text-xs font-medium truncate pr-10 leading-tight">
                    {conv.title}
                  </span>
                )}
                {conv.lastMessage && (
                  <span className="text-xs text-muted-foreground truncate leading-tight">
                    {conv.lastMessage}
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/60">
                    {timeAgo(conv.updatedAt)}
                  </span>
                  {conv.messageCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/60">
                      · {conv.messageCount} msgs
                    </span>
                  )}
                </div>

                {/* Hover actions */}
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-card/80 backdrop-blur-sm rounded pl-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={e => startEdit(conv, e)}
                    title="Rename"
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
                    title="Delete"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
