import { useState } from "react";
import { UserCircle2, Pencil, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useUserPeerCard, type PeerCardTone } from "@/lib/userPeerCard";

interface Props {
  collapsed?: boolean;
}

export function UserIdentityCard({ collapsed = false }: Props) {
  const { card, update } = useUserPeerCard();
  const [open, setOpen] = useState(false);
  const [skillInput, setSkillInput] = useState("");

  const initials = card.displayName
    ? card.displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const hasIdentity = !!(card.displayName || card.role);

  const addSkill = () => {
    const s = skillInput.trim();
    if (!s || card.skills.includes(s)) return;
    update({ skills: [...card.skills, s] });
    setSkillInput("");
  };

  const removeSkill = (skill: string) =>
    update({ skills: card.skills.filter((s) => s !== skill) });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {collapsed ? (
          <button
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center border text-xs font-bold transition-colors",
              hasIdentity
                ? "bg-accent text-accent-foreground border-accent/50"
                : "bg-sidebar-hover border-sidebar-border/30 text-muted-foreground"
            )}
            title="Your Identity Card"
          >
            {hasIdentity ? initials : <UserCircle2 className="w-5 h-5" />}
          </button>
        ) : (
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-sidebar-hover border border-sidebar-border/30 hover:border-accent/30 transition-colors text-left group"
            title="Edit your identity card"
          >
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border",
                hasIdentity
                  ? "bg-accent text-accent-foreground border-accent/40"
                  : "bg-background border-sidebar-border/30 text-muted-foreground"
              )}
            >
              {hasIdentity ? initials : <UserCircle2 className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">
                {card.displayName || "Set your identity"}
              </p>
              {card.role && (
                <p className="text-[10px] text-muted-foreground truncate">{card.role}</p>
              )}
            </div>
            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-80 p-0 overflow-hidden"
      >
        <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Your Identity Card</p>
            <p className="text-[10px] text-muted-foreground">
              Persists across all projects — the AI knows you everywhere
            </p>
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Display Name
              </label>
              <Input
                placeholder="Your name"
                value={card.displayName}
                onChange={(e) => update({ displayName: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Role
              </label>
              <Input
                placeholder="e.g., Engineer"
                value={card.role}
                onChange={(e) => update({ role: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Bio / Context
            </label>
            <Textarea
              placeholder="Brief context the AI should always know about you..."
              value={card.bio}
              onChange={(e) => update({ bio: e.target.value })}
              className="text-sm resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Response Style
            </label>
            <Select
              value={card.tone}
              onValueChange={(v: PeerCardTone) => update({ tone: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="technical">Technical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Skills / Expertise
            </label>
            <div className="flex gap-1.5">
              <Input
                placeholder="Add a skill..."
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSkill()}
                className="h-8 text-sm"
              />
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 shrink-0"
                onClick={addSkill}
                disabled={!skillInput.trim()}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            {card.skills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {card.skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="text-[10px] px-1.5 gap-1 cursor-pointer hover:bg-destructive/20"
                    onClick={() => removeSkill(skill)}
                    title="Click to remove"
                  >
                    {skill} <X className="w-2.5 h-2.5" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {card.timezone && (
            <p className="text-[10px] text-muted-foreground">
              Timezone auto-detected: {card.timezone}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
