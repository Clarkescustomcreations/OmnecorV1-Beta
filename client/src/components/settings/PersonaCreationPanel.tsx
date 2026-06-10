import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { toast } from "sonner";
import {
  User, Wand2, Mic, Video, Bot, Plus, Trash2,
  Upload, Volume2, Sparkles, Globe, Brain,
  AlertCircle, CheckCircle2, Loader2, Camera, Play,
  UserCircle2, Copy, RefreshCw, X, Network, ExternalLink,
  Power, Cpu, CloudLightning, Server, Plug, MessageSquare,
  Webhook, Bell, Mail, Link2, Radio, CircleDot, Wallet,
} from "lucide-react";
import type { NeuralBrainMap } from "../../types/neural";

const NEURAL_MAPS_KEY = "omnecor_neural_maps";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PersonaType = "self_clone" | "social_media" | "agent";
type VoiceProvider = "xtts" | "elevenlabs" | "rvc";
type ModelBackend = "ollama" | "ommesh" | "cloud_compute" | "api";
type MessagingChannel = "in_app_chat" | "webhook" | "n8n" | "desktop_notifications" | "email";

interface PersonaMessaging {
  enabledChannels: MessagingChannel[];
  webhookUrl: string;
  webhookSecret: string;
  n8nWorkflowId: string;
  emailAddress: string;
}

interface PersonaModelConfig {
  backend: ModelBackend;
  ollamaModel: string;
  cloudSessionId: string;
  apiProviderId: string;
  apiModelId: string;
  apiKey: string;
}

interface AgenticWallet {
  id: string;
  label: string;
  address: string;
  isNew: boolean;
}

interface Persona {
  id: string;
  name: string;
  type: PersonaType;
  bio: string;
  traits: string[];
  avatarDataUrl: string | null;
  voiceProvider: VoiceProvider;
  voiceModelId: string;
  videoReferenceDataUrl: string | null;
  videoProvider: "openart" | "fal" | "did";
  imagePrompt: string;
  agentSystemPrompt: string;
  agentTools: string[];
  brainMapId: string | null;
  // identity extras
  assignedEmail: string;
  agenticWallet: AgenticWallet | null;
  // always-on + model connection
  alwaysOn: boolean;
  modelConfig: PersonaModelConfig;
  messaging: PersonaMessaging;
  createdAt: string;
}

const PERSONA_STORE_KEY = "omnecor_personas";

function emptyPersona(): Persona {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "self_clone",
    bio: "",
    traits: [],
    avatarDataUrl: null,
    voiceProvider: "xtts",
    voiceModelId: "",
    videoReferenceDataUrl: null,
    videoProvider: "openart",
    imagePrompt: "",
    agentSystemPrompt: "",
    agentTools: [],
    brainMapId: null,
    assignedEmail: "",
    agenticWallet: null,
    alwaysOn: false,
    modelConfig: {
      backend: "ollama",
      ollamaModel: "",
      cloudSessionId: "",
      apiProviderId: "openai",
      apiModelId: "",
      apiKey: "",
    },
    messaging: {
      enabledChannels: ["in_app_chat"],
      webhookUrl: "",
      webhookSecret: "",
      n8nWorkflowId: "",
      emailAddress: "",
    },
    createdAt: new Date().toISOString(),
  };
}

const WALLET_STORE_KEY = "omnecor_agentic_wallets";

function loadWallets(): AgenticWallet[] {
  try { return JSON.parse(localStorage.getItem(WALLET_STORE_KEY) ?? "[]"); }
  catch { return []; }
}

function saveWallet(w: AgenticWallet) {
  const wallets = loadWallets();
  if (!wallets.find(x => x.id === w.id)) {
    wallets.push(w);
    localStorage.setItem(WALLET_STORE_KEY, JSON.stringify(wallets));
  }
}

function loadPersonas(): Persona[] {
  try {
    return JSON.parse(localStorage.getItem(PERSONA_STORE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function savePersonas(personas: Persona[]) {
  localStorage.setItem(PERSONA_STORE_KEY, JSON.stringify(personas));
}

// ---------------------------------------------------------------------------
// Type selector card
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { value: PersonaType; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: "self_clone",
    label: "Self Clone",
    desc: "Digital replica of yourself — same voice, face, and mannerisms.",
    icon: <Camera className="w-4 h-4" />,
  },
  {
    value: "social_media",
    label: "Social Media Persona",
    desc: "A crafted public identity for content creation and brand presence.",
    icon: <Globe className="w-4 h-4" />,
  },
  {
    value: "agent",
    label: "Omnecor Agent",
    desc: "Custom AI agent with a persona, voice, and specialized system prompt.",
    icon: <Brain className="w-4 h-4" />,
  },
];

// ---------------------------------------------------------------------------
// Avatar preview card (left column)
// ---------------------------------------------------------------------------

function PersonaPreviewCard({
  persona,
  onSave,
  onClear,
  isSaving,
}: {
  persona: Persona;
  onSave: () => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const typeOpt = TYPE_OPTIONS.find(t => t.value === persona.type)!;
  const linkedMap = persona.brainMapId
    ? ((): NeuralBrainMap | undefined => {
        try {
          const maps: NeuralBrainMap[] = JSON.parse(localStorage.getItem(NEURAL_MAPS_KEY) ?? "[]");
          return maps.find(m => m.id === persona.brainMapId) ?? undefined;
        } catch { return undefined; }
      })()
    : undefined;;

  return (
    <div className="flex flex-col gap-4 sticky top-0">
      {/* Avatar */}
      <div className="relative rounded-xl overflow-hidden border-2 border-border bg-muted/30 aspect-square w-full max-w-[220px] mx-auto flex items-center justify-center">
        {persona.avatarDataUrl ? (
          <img
            src={persona.avatarDataUrl}
            alt="Persona avatar"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <UserCircle2 className="w-16 h-16 opacity-30" />
            <span className="text-xs">No avatar yet</span>
          </div>
        )}
        {persona.avatarDataUrl && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        )}
      </div>

      {/* Identity summary */}
      <div className="space-y-1.5 text-center">
        <h3 className="text-base font-semibold truncate">
          {persona.name || <span className="text-muted-foreground italic">Unnamed persona</span>}
        </h3>
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs gap-1">
            {typeOpt.icon}
            {typeOpt.label}
          </Badge>
          {persona.voiceModelId && (
            <Badge variant="outline" className="text-xs gap-1">
              <Mic className="w-3 h-3" />
              Voice set
            </Badge>
          )}
          {persona.agentSystemPrompt && persona.type === "agent" && (
            <Badge variant="outline" className="text-xs gap-1">
              <Bot className="w-3 h-3" />
              Agent
            </Badge>
          )}
          {linkedMap && (
            <Badge variant="outline" className="text-xs gap-1">
              <Network className="w-3 h-3" />
              {linkedMap.name}
            </Badge>
          )}
          {persona.alwaysOn && (
            <Badge className="text-xs gap-1 bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/20">
              <CircleDot className="w-3 h-3 animate-pulse" />
              Always-On
            </Badge>
          )}
          {persona.assignedEmail && (
            <Badge variant="outline" className="text-xs gap-1">
              <Mail className="w-3 h-3" />
              Email set
            </Badge>
          )}
          {persona.agenticWallet && (
            <Badge variant="outline" className="text-xs gap-1">
              <Wallet className="w-3 h-3" />
              Wallet
            </Badge>
          )}
        </div>
        {persona.traits.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-center mt-2">
            {persona.traits.slice(0, 4).map(t => (
              <span
                key={t}
                className="text-[10px] bg-accent/20 text-accent-foreground rounded px-1.5 py-0.5"
              >
                {t}
              </span>
            ))}
            {persona.traits.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{persona.traits.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button
          onClick={onSave}
          disabled={!persona.name || isSaving}
          className="w-full"
          size="sm"
        >
          {isSaving ? (
            <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Saving…</>
          ) : (
            <><CheckCircle2 className="w-3.5 h-3.5 mr-2" />Save Persona</>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} className="w-full text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          New Persona
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity tab
// ---------------------------------------------------------------------------

function useStoredBrainMaps(): NeuralBrainMap[] {
  const [maps, setMaps] = useState<NeuralBrainMap[]>(() => {
    try { return JSON.parse(localStorage.getItem(NEURAL_MAPS_KEY) ?? "[]"); }
    catch { return []; }
  });

  // Refresh if the user creates a map in another tab/window while this is open
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === NEURAL_MAPS_KEY) {
        try { setMaps(JSON.parse(e.newValue ?? "[]")); } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return maps;
}

const MODE_COLORS: Record<string, string> = {
  standard: "bg-blue-500/20 text-blue-400",
  coding:   "bg-green-500/20 text-green-400",
  research: "bg-purple-500/20 text-purple-400",
  fiction:  "bg-amber-500/20 text-amber-400",
  roleplay: "bg-pink-500/20 text-pink-400",
};

function IdentityTab({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const [traitInput, setTraitInput] = useState("");
  const brainMaps = useStoredBrainMaps();

  const addTrait = () => {
    const t = traitInput.trim();
    if (!t || persona.traits.includes(t)) return;
    onChange({ traits: [...persona.traits, t] });
    setTraitInput("");
  };

  const removeTrait = (t: string) =>
    onChange({ traits: persona.traits.filter(x => x !== t) });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="persona-name">Display Name</Label>
        <Input
          id="persona-name"
          placeholder="e.g. Alex — Brand Voice"
          value={persona.name}
          onChange={e => onChange({ name: e.target.value })}
          maxLength={60}
        />
      </div>

      <div className="space-y-2">
        <Label>Persona Type</Label>
        <div className="grid grid-cols-1 gap-2">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange({ type: opt.value })}
              aria-pressed={persona.type === opt.value}
              className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${persona.type === opt.value
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-muted-foreground"
                }`}
            >
              <span className={`mt-0.5 ${persona.type === opt.value ? "text-primary" : "text-muted-foreground"}`}>
                {opt.icon}
              </span>
              <div>
                <p className="text-sm font-medium leading-none mb-0.5">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="persona-bio">Bio / Backstory</Label>
        <Textarea
          id="persona-bio"
          placeholder="A short description of who this persona is, their expertise, and communication style…"
          className="min-h-[90px] resize-none"
          value={persona.bio}
          onChange={e => onChange({ bio: e.target.value })}
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground text-right">{persona.bio.length}/500</p>
      </div>

      <div className="space-y-2">
        <Label>Personality Traits</Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. confident, empathetic…"
            value={traitInput}
            onChange={e => setTraitInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTrait(); } }}
            maxLength={30}
          />
          <Button variant="outline" size="sm" onClick={addTrait} disabled={!traitInput.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {persona.traits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {persona.traits.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-xs bg-secondary text-secondary-foreground rounded-full px-2.5 py-1"
              >
                {t}
                <button
                  onClick={() => removeTrait(t)}
                  aria-label={`Remove trait ${t}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Neural Brain Map binding */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-accent" />
            <Label>Neural Brain Map</Label>
          </div>
          <a
            href="/brain-map"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open Brain Map page"
          >
            <ExternalLink className="w-3 h-3" />
            Manage maps
          </a>
        </div>

        {brainMaps.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <span>
              No brain maps found. Create one in{" "}
              <a href="/brain-map" className="underline underline-offset-2 hover:text-foreground">
                Brain Map
              </a>{" "}
              first, then return here to link it.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {/* None option */}
            <button
              onClick={() => onChange({ brainMapId: null })}
              aria-pressed={persona.brainMapId === null}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${persona.brainMapId === null
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:border-muted-foreground text-muted-foreground"
                }`}
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">No brain map</span>
            </button>

            {brainMaps.map(m => {
              const isSelected = persona.brainMapId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onChange({ brainMapId: m.id })}
                  aria-pressed={isSelected}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-muted-foreground"
                    }`}
                >
                  <Brain className={`w-4 h-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{m.name}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium capitalize ${MODE_COLORS[m.mode] ?? "bg-muted text-muted-foreground"}`}>
                        {m.mode}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.rootDirectories.length === 0
                        ? "No roots configured"
                        : m.rootDirectories.length === 1
                          ? m.rootDirectories[0]
                          : `${m.rootDirectories.length} root directories`}
                    </p>
                  </div>
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The linked map's knowledge graph and semantic context will be injected when this persona is active in chat or an agent session.
        </p>
      </div>

      <Separator />

      {/* Assigned email */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-accent" />
          <Label htmlFor="assigned-email">Assigned Email Address</Label>
        </div>
        <Input
          id="assigned-email"
          type="email"
          placeholder="agent@yourdomain.com — email identity for this persona"
          value={persona.assignedEmail}
          onChange={e => onChange({ assignedEmail: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Give this persona a dedicated email address. Used by the Email messaging channel and Agent Networking outreach.
        </p>
      </div>

      <Separator />

      {/* Agentic wallet */}
      <AgenticWalletSection persona={persona} onChange={onChange} />
    </div>
  );
}

function AgenticWalletSection({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const [wallets, setWallets] = React.useState<AgenticWallet[]>(() => loadWallets());
  const [newAddress, setNewAddress] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");

  const createWallet = () => {
    if (!newAddress.trim()) return;
    const w: AgenticWallet = {
      id: crypto.randomUUID(),
      label: newLabel.trim() || newAddress.slice(0, 10) + "…",
      address: newAddress.trim(),
      isNew: true,
    };
    saveWallet(w);
    setWallets(prev => [...prev, w]);
    onChange({ agenticWallet: w });
    setNewAddress("");
    setNewLabel("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-accent" />
        <Label>Agentic Wallet</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Assign an existing wallet address or create a new one for this persona's on-chain identity and budget.
      </p>

      {/* Existing wallets */}
      {wallets.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5">
          <button
            onClick={() => onChange({ agenticWallet: null })}
            aria-pressed={persona.agenticWallet === null}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${persona.agenticWallet === null
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:border-muted-foreground text-muted-foreground"
              }`}
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">No wallet</span>
          </button>

          {wallets.map(w => {
            const isSelected = persona.agenticWallet?.id === w.id;
            return (
              <button
                key={w.id}
                onClick={() => onChange({ agenticWallet: w })}
                aria-pressed={isSelected}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:border-muted-foreground"
                  }`}
              >
                <Wallet className={`w-4 h-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.label}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{w.address}</p>
                </div>
                {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Create new wallet */}
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Add Wallet</p>
        <div className="space-y-1.5">
          <Input
            placeholder="Wallet address (0x… or ENS)"
            value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
            className="text-xs font-mono"
          />
          <Input
            placeholder="Label (optional, e.g. 'Agent Treasury')"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            className="text-xs"
          />
        </div>
        <Button size="sm" variant="outline" onClick={createWallet} disabled={!newAddress.trim()} className="w-full">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Assign Wallet
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance tab
// ---------------------------------------------------------------------------

function AppearanceTab({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const providersQuery = trpc.imageGen.providers.useQuery();
  const generateMutation = trpc.imageGen.generate.useMutation({
    onSuccess: (data) => {
      if (data.imageUrl) onChange({ avatarDataUrl: data.imageUrl });
      toast.success("Avatar generated");
    },
    onError: (e) => toast.error("Generation failed: " + e.message),
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => onChange({ avatarDataUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
  }, [onChange]);

  const bestProvider = (() => {
    if (providersQuery.data?.fal) return "fal";
    if (providersQuery.data?.openart) return "openart";
    return "local";
  })();

  return (
    <div className="space-y-5">
      {/* Upload section */}
      <div className="space-y-2">
        <Label>Upload Photo / Reference Image</Label>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary hover:bg-primary/5 cursor-pointer transition-colors p-6"
        >
          {persona.avatarDataUrl ? (
            <img
              src={persona.avatarDataUrl}
              alt="Avatar preview"
              className="h-28 w-28 rounded-full object-cover border-2 border-border"
            />
          ) : (
            <>
              <Upload className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click to upload a photo</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WEBP — used as avatar and voice clone reference</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileUpload}
            aria-label="Upload persona photo"
          />
        </div>
        {persona.avatarDataUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onChange({ avatarDataUrl: null })}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Remove photo
          </Button>
        )}
      </div>

      <Separator />

      {/* AI generation section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <Label>Generate Avatar with AI</Label>
        </div>

        {!providersQuery.data?.fal && !providersQuery.data?.openart && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Add <code className="bg-muted px-1 rounded">FAL_KEY</code> or{" "}
              <code className="bg-muted px-1 rounded">OPENART_API_KEY</code> to your{" "}
              <code className="bg-muted px-1 rounded">.env</code> for cloud generation.
              ComfyUI (local) is available if running.
            </span>
          </div>
        )}

        <Textarea
          placeholder="Describe the avatar appearance: professional headshot, mid-30s, dark hair, blue background, photorealistic…"
          className="min-h-[80px] resize-none text-sm"
          value={persona.imagePrompt}
          onChange={e => onChange({ imagePrompt: e.target.value })}
          maxLength={400}
        />

        <Button
          size="sm"
          onClick={() =>
            generateMutation.mutate({
              prompt: persona.imagePrompt || `Professional portrait avatar for ${persona.name || "persona"}`,
              provider: bestProvider as "local" | "fal" | "openart",
              width: 512,
              height: 512,
            })
          }
          disabled={generateMutation.isPending || providersQuery.isLoading}
        >
          {generateMutation.isPending ? (
            <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Generating…</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5 mr-2" />Generate Avatar</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice tab
// ---------------------------------------------------------------------------

function VoiceTab({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [testText, setTestText] = useState("Hello, I'm your Omnecor persona. How can I help you today?");

  const rvcModels = trpc.voice.listRvcModels.useQuery({ modelsDir: "./models/rvc" });
  const elevenStatus = trpc.voice.elevenLabsStatus.useQuery();
  const elevenVoices = trpc.voice.listElevenLabsVoices.useQuery(undefined, {
    enabled: persona.voiceProvider === "elevenlabs" && (elevenStatus.data?.configured ?? false),
  });

  const synthMutation = trpc.voice.synthesizeElevenLabs.useMutation({
    onSuccess: (data) => {
      const src = `data:${data.mimeType};base64,${data.audioBase64}`;
      if (audioRef.current) {
        audioRef.current.src = src;
        audioRef.current.play().catch(() => {});
      }
      toast.success("Preview ready");
    },
    onError: (e) => toast.error("Synthesis failed: " + e.message),
  });

  const xttsTestMutation = trpc.voice.synthesize.useMutation({
    onSuccess: () => toast.success("XTTS synthesis queued — check TTS panel for output"),
    onError: (e) => toast.error("Synthesis failed: " + e.message),
  });

  const PROVIDER_OPTIONS: { value: VoiceProvider; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: "xtts", label: "Local XTTS-v2", icon: <Bot className="w-3.5 h-3.5" />, desc: "Local voice cloning. Upload a reference audio sample to clone a voice." },
    { value: "rvc", label: "RVC Conversion", icon: <Mic className="w-3.5 h-3.5" />, desc: "Retrieval-based voice conversion using trained RVC models." },
    { value: "elevenlabs", label: "ElevenLabs", icon: <Volume2 className="w-3.5 h-3.5" />, desc: "Cloud synthesis with ultra-realistic voices." },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Voice Engine</Label>
        <div className="grid grid-cols-1 gap-2">
          {PROVIDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange({ voiceProvider: opt.value, voiceModelId: "" })}
              aria-pressed={persona.voiceProvider === opt.value}
              className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${persona.voiceProvider === opt.value
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-muted-foreground"
                }`}
            >
              <span className={`mt-0.5 ${persona.voiceProvider === opt.value ? "text-primary" : "text-muted-foreground"}`}>
                {opt.icon}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium leading-none">{opt.label}</p>
                  {opt.value === "elevenlabs" && (
                    elevenStatus.data?.configured
                      ? <Badge variant="default" className="text-[10px] py-0 h-4">Active</Badge>
                      : <Badge variant="secondary" className="text-[10px] py-0 h-4">No key</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* XTTS */}
      {persona.voiceProvider === "xtts" && (
        <div className="space-y-3 rounded-lg bg-muted/30 border p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Reference Audio Upload</p>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-background hover:border-primary hover:bg-primary/5 cursor-pointer p-3 transition-colors"
          >
            <Upload className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Upload voice sample</p>
              <p className="text-xs text-muted-foreground">WAV or MP3, 10–30 seconds for best results</p>
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*" className="sr-only" aria-label="Upload voice reference" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xtts-ref">Or enter reference audio path</Label>
            <Input
              id="xtts-ref"
              placeholder="/models/voices/my-voice.wav"
              value={persona.voiceModelId}
              onChange={e => onChange({ voiceModelId: e.target.value })}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => xttsTestMutation.mutate({ text: testText, speakerWavPath: persona.voiceModelId })}
            disabled={!persona.voiceModelId || xttsTestMutation.isPending}
          >
            {xttsTestMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Testing…</>
              : <><Play className="w-3.5 h-3.5 mr-2" />Test Voice</>}
          </Button>
        </div>
      )}

      {/* RVC */}
      {persona.voiceProvider === "rvc" && (
        <div className="space-y-3 rounded-lg bg-muted/30 border p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">RVC Model</p>
          <Select value={persona.voiceModelId} onValueChange={v => onChange({ voiceModelId: v })}>
            <SelectTrigger>
              <SelectValue placeholder={rvcModels.isLoading ? "Loading models…" : "Select RVC model"} />
            </SelectTrigger>
            <SelectContent>
              {(rvcModels.data?.models ?? []).map((m: { id?: string; name?: string } | string) => {
                const id = typeof m === "string" ? m : (m.id ?? "");
                const name = typeof m === "string" ? m : (m.name ?? m.id ?? "");
                return <SelectItem key={id} value={id}>{name}</SelectItem>;
              })}
              {(rvcModels.data?.models ?? []).length === 0 && !rvcModels.isLoading && (
                <SelectItem value="__none" disabled>No RVC models found in ./models/rvc</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ElevenLabs */}
      {persona.voiceProvider === "elevenlabs" && (
        <div className="space-y-3 rounded-lg bg-muted/30 border p-4">
          {!elevenStatus.data?.configured ? (
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              Add <code className="bg-muted px-1 rounded mx-1">ELEVENLABS_API_KEY</code> to your .env and restart.
            </p>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">ElevenLabs Voice</p>
              <Select value={persona.voiceModelId} onValueChange={v => onChange({ voiceModelId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={elevenVoices.isLoading ? "Loading voices…" : "Select voice"} />
                </SelectTrigger>
                <SelectContent>
                  {(elevenVoices.data?.voices ?? []).map(v => (
                    <SelectItem key={v.voice_id} value={v.voice_id}>
                      {v.name}
                      <span className="ml-2 text-xs text-muted-foreground">({v.category})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      <div className="space-y-2">
        <Label htmlFor="voice-preview-text">Test phrase</Label>
        <div className="flex gap-2">
          <Input
            id="voice-preview-text"
            value={testText}
            onChange={e => setTestText(e.target.value)}
            className="flex-1"
          />
          {persona.voiceProvider === "elevenlabs" && elevenStatus.data?.configured && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                synthMutation.mutate({ voiceId: persona.voiceModelId || "21m00Tcm4TlvDq8ikWAM", text: testText })
              }
              disabled={synthMutation.isPending || !testText}
              aria-label="Preview voice"
            >
              {synthMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
            </Button>
          )}
        </div>
        <audio ref={audioRef} controls className="w-full mt-1 h-8" aria-label="Voice preview playback" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video Avatar tab
// ---------------------------------------------------------------------------

function VideoAvatarTab({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const videoFileRef = useRef<HTMLInputElement>(null);
  const providersQuery = trpc.imageGen.providers.useQuery();

  const VIDEO_PROVIDERS = [
    {
      value: "openart" as const,
      label: "OpenArt",
      desc: "Video character generation via OpenArt API.",
      configured: providersQuery.data?.openart ?? false,
    },
    {
      value: "fal" as const,
      label: "Fal.ai",
      desc: "High-quality video synthesis via Fal.ai.",
      configured: providersQuery.data?.fal ?? false,
    },
    {
      value: "did" as const,
      label: "D-ID Studio",
      desc: "Realistic talking-head video from a photo + audio.",
      configured: false,
    },
  ];

  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      toast.error("Please upload an image or video file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => onChange({ videoReferenceDataUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
  }, [onChange]);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-accent/20 bg-accent/5 px-4 py-3 text-sm flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-foreground">Talking-Head Video Generation</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload a reference photo or video of your persona. Pair it with a voice in the Voice tab to generate
            lip-synced video avatars for social media, agents, or video messages.
          </p>
        </div>
      </div>

      {/* Reference upload */}
      <div className="space-y-2">
        <Label>Reference Photo / Video</Label>
        <div
          onClick={() => videoFileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary hover:bg-primary/5 cursor-pointer transition-colors p-6"
        >
          {persona.videoReferenceDataUrl ? (
            persona.videoReferenceDataUrl.startsWith("data:video") ? (
              <video
                src={persona.videoReferenceDataUrl}
                className="h-28 rounded-lg object-cover"
                controls
              />
            ) : (
              <img
                src={persona.videoReferenceDataUrl}
                alt="Video reference"
                className="h-28 rounded-lg object-cover"
              />
            )
          ) : (
            <>
              <Video className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Upload reference image or short video</p>
              <p className="text-xs text-muted-foreground">Frontal face, clear lighting, neutral expression</p>
            </>
          )}
          <input
            ref={videoFileRef}
            type="file"
            accept="image/*,video/*"
            className="sr-only"
            onChange={handleVideoUpload}
            aria-label="Upload video reference"
          />
        </div>
        {persona.videoReferenceDataUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onChange({ videoReferenceDataUrl: null })}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Remove reference
          </Button>
        )}
      </div>

      {/* Provider selection */}
      <div className="space-y-2">
        <Label>Video Provider</Label>
        <div className="grid grid-cols-1 gap-2">
          {VIDEO_PROVIDERS.map(p => (
            <button
              key={p.value}
              onClick={() => onChange({ videoProvider: p.value })}
              aria-pressed={persona.videoProvider === p.value}
              className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${persona.videoProvider === p.value
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-muted-foreground"
                }`}
            >
              <Video className={`w-4 h-4 shrink-0 ${persona.videoProvider === p.value ? "text-primary" : "text-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  {p.configured
                    ? <Badge variant="default" className="text-[10px] py-0 h-4"><CheckCircle2 className="w-2.5 h-2.5 mr-1" />Ready</Badge>
                    : <Badge variant="secondary" className="text-[10px] py-0 h-4">Not configured</Badge>
                  }
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
        Video generation is triggered from the chat interface or pipelines once a persona is saved.
        Configure API keys in{" "}
        <code className="bg-muted px-1 rounded">Settings → API Providers</code>.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Config tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Always-On + Model backend section
// ---------------------------------------------------------------------------

const MODEL_BACKENDS: {
  value: ModelBackend;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "ollama",
    label: "Ollama (Local)",
    desc: "Run entirely on your workstation using local Ollama models.",
    icon: <Server className="w-4 h-4" />,
  },
  {
    value: "ommesh",
    label: "Omesh Network",
    desc: "Distribute inference across your local mesh of Omnecor nodes.",
    icon: <Network className="w-4 h-4" />,
  },
  {
    value: "cloud_compute",
    label: "Cloud Compute",
    desc: "Use an active RunPod, Vast.ai, or Lambda GPU session.",
    icon: <CloudLightning className="w-4 h-4" />,
  },
  {
    value: "api",
    label: "External API",
    desc: "Connect to OpenAI, Anthropic, Gemini, or any compatible API.",
    icon: <Plug className="w-4 h-4" />,
  },
];

const API_PROVIDERS = [
  { id: "openai",    label: "OpenAI"    },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini",    label: "Gemini"    },
  { id: "grok",      label: "Grok"      },
  { id: "ollama",    label: "Ollama (remote)" },
];

function AlwaysOnModelSection({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const mc = persona.modelConfig;
  const setMc = (patch: Partial<PersonaModelConfig>) =>
    onChange({ modelConfig: { ...mc, ...patch } });

  const ollamaModels = trpc.ollama.listModels.useQuery(undefined, {
    enabled: mc.backend === "ollama" && persona.alwaysOn,
    retry: false,
  });

  const meshPeers = trpc.ommesh.discover.useQuery(undefined, {
    enabled: mc.backend === "ommesh" && persona.alwaysOn,
    refetchInterval: 15_000,
    retry: false,
  });

  const cloudSessions = trpc.cloudCompute.getActiveSessions.useQuery(undefined, {
    enabled: mc.backend === "cloud_compute" && persona.alwaysOn,
    refetchInterval: 30_000,
    retry: false,
  });

  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      {/* Always-On toggle header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Power className={`w-4 h-4 ${persona.alwaysOn ? "text-green-400" : "text-muted-foreground"}`} />
          <div>
            <p className="text-sm font-semibold">Always-On Agent</p>
            <p className="text-xs text-muted-foreground">
              Keep this agent running continuously and ready to respond.
            </p>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={persona.alwaysOn}
          onClick={() => onChange({ alwaysOn: !persona.alwaysOn })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            ${persona.alwaysOn ? "bg-green-500" : "bg-muted-foreground/30"}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
              ${persona.alwaysOn ? "translate-x-6" : "translate-x-1"}`}
          />
        </button>
      </div>

      {persona.alwaysOn && (
        <>
          {/* Status pulse */}
          <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2">
            <CircleDot className="w-3.5 h-3.5 text-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">Agent is active — awaiting messages</span>
          </div>

          <Separator />

          {/* Backend selection */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Model Backend</p>
            <div className="grid grid-cols-2 gap-2">
              {MODEL_BACKENDS.map(b => (
                <button
                  key={b.value}
                  onClick={() => setMc({ backend: b.value })}
                  aria-pressed={mc.backend === b.value}
                  className={`flex items-start gap-2 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${mc.backend === b.value
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-muted-foreground"
                    }`}
                >
                  <span className={`mt-0.5 shrink-0 ${mc.backend === b.value ? "text-primary" : "text-muted-foreground"}`}>
                    {b.icon}
                  </span>
                  <div>
                    <p className="text-xs font-semibold leading-none mb-0.5">{b.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{b.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Ollama model picker */}
          {mc.backend === "ollama" && (
            <div className="space-y-2">
              <Label htmlFor="ollama-model-select">Local Model</Label>
              {ollamaModels.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Fetching Ollama models…
                </div>
              ) : ollamaModels.isError ? (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Ollama not reachable — is it running?
                </p>
              ) : (
                <Select value={mc.ollamaModel} onValueChange={v => setMc({ ollamaModel: v })}>
                  <SelectTrigger id="ollama-model-select">
                    <SelectValue placeholder="Select a local model" />
                  </SelectTrigger>
                  <SelectContent>
                    {(ollamaModels.data?.models ?? []).map(m => (
                      <SelectItem key={m.name} value={m.name}>
                        {m.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {(m.size / 1e9).toFixed(1)} GB
                        </span>
                      </SelectItem>
                    ))}
                    {(ollamaModels.data?.models ?? []).length === 0 && (
                      <SelectItem value="__none" disabled>No local models found</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Ommesh peer status */}
          {mc.backend === "ommesh" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Mesh Peers</p>
              {meshPeers.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Scanning LAN…
                </div>
              ) : (
                <div className="rounded-md border bg-background px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Radio className="w-4 h-4 text-accent" />
                    <span>
                      {(meshPeers.data ?? []).length === 0
                        ? "No mesh peers discovered"
                        : `${(meshPeers.data ?? []).length} peer${(meshPeers.data ?? []).length !== 1 ? "s" : ""} online`}
                    </span>
                  </div>
                  <Badge variant={(meshPeers.data ?? []).length > 0 ? "default" : "secondary"} className="text-xs">
                    {(meshPeers.data ?? []).length > 0 ? "Mesh ready" : "No peers"}
                  </Badge>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Inference is routed to the healthiest peer automatically via Omesh.
              </p>
            </div>
          )}

          {/* Cloud compute session picker */}
          {mc.backend === "cloud_compute" && (
            <div className="space-y-2">
              <Label htmlFor="cloud-session-select">Active GPU Session</Label>
              {cloudSessions.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading sessions…
                </div>
              ) : (cloudSessions.data ?? []).length === 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  No active sessions. Start one in{" "}
                  <span className="text-foreground font-medium ml-1">Settings → Cloud Compute</span>.
                </div>
              ) : (
                <Select value={mc.cloudSessionId} onValueChange={v => setMc({ cloudSessionId: v })}>
                  <SelectTrigger id="cloud-session-select">
                    <SelectValue placeholder="Select a GPU session" />
                  </SelectTrigger>
                  <SelectContent>
                    {(cloudSessions.data ?? []).map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-medium">{s.instanceLabel}</span>
                        <span className="ml-2 text-xs text-muted-foreground capitalize">
                          {s.provider} · {s.elapsedMinutes}m · ${s.currentCostDollars.toFixed(3)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* External API config */}
          {mc.backend === "api" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="api-provider-select">Provider</Label>
                  <Select value={mc.apiProviderId} onValueChange={v => setMc({ apiProviderId: v })}>
                    <SelectTrigger id="api-provider-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {API_PROVIDERS.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="api-model-id">Model ID</Label>
                  <Input
                    id="api-model-id"
                    placeholder="e.g. gpt-4o, claude-sonnet-4-6"
                    value={mc.apiModelId}
                    onChange={e => setMc({ apiModelId: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-key-input">API Key (optional override)</Label>
                <Input
                  id="api-key-input"
                  type="password"
                  placeholder="Leave blank to use key from Settings → API Providers"
                  value={mc.apiKey}
                  onChange={e => setMc({ apiKey: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Per-persona key takes precedence over the global key in API Providers.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messaging channels section
// ---------------------------------------------------------------------------

const CHANNEL_OPTIONS: {
  value: MessagingChannel;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "in_app_chat",
    label: "In-App Chat",
    desc: "Chat with this agent directly inside Omnecor.",
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    value: "webhook",
    label: "Webhook",
    desc: "Send messages to this agent via HTTP POST to a configurable endpoint.",
    icon: <Webhook className="w-4 h-4" />,
  },
  {
    value: "n8n",
    label: "n8n Workflow",
    desc: "Trigger this agent from an n8n automation workflow.",
    icon: <Link2 className="w-4 h-4" />,
  },
  {
    value: "desktop_notifications",
    label: "Desktop Notifications",
    desc: "Receive OS-level alerts when the agent produces a response.",
    icon: <Bell className="w-4 h-4" />,
  },
  {
    value: "email",
    label: "Email",
    desc: "Route messages through an email address.",
    icon: <Mail className="w-4 h-4" />,
  },
];

function MessagingChannelsSection({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const ms = persona.messaging;
  const setMs = (patch: Partial<PersonaMessaging>) =>
    onChange({ messaging: { ...ms, ...patch } });

  const toggleChannel = (ch: MessagingChannel) => {
    const enabled = ms.enabledChannels.includes(ch);
    setMs({
      enabledChannels: enabled
        ? ms.enabledChannels.filter(c => c !== ch)
        : [...ms.enabledChannels, ch],
    });
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      toast.error("This browser does not support desktop notifications");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      toast.success("Desktop notifications enabled");
      if (!ms.enabledChannels.includes("desktop_notifications"))
        toggleChannel("desktop_notifications");
    } else {
      toast.error("Notification permission denied");
    }
  };

  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-accent" />
        <p className="text-sm font-semibold">Messaging Channels</p>
      </div>

      <div className="space-y-2">
        {CHANNEL_OPTIONS.map(ch => {
          const active = ms.enabledChannels.includes(ch.value);
          return (
            <div
              key={ch.value}
              className={`rounded-lg border transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-background"}`}
            >
              <button
                onClick={() => {
                  if (ch.value === "desktop_notifications" && !active) {
                    requestNotificationPermission();
                  } else {
                    toggleChannel(ch.value);
                  }
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                aria-pressed={active}
              >
                <span className={active ? "text-primary" : "text-muted-foreground"}>
                  {ch.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ch.label}</p>
                  <p className="text-xs text-muted-foreground">{ch.desc}</p>
                </div>
                <div
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0
                    ${active ? "bg-primary" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                      ${active ? "translate-x-4.5" : "translate-x-0.5"}`}
                    style={{ transform: active ? "translateX(18px)" : "translateX(2px)" }}
                  />
                </div>
              </button>

              {/* Per-channel config */}
              {active && ch.value === "webhook" && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/50">
                  <div className="space-y-1.5">
                    <Label htmlFor="webhook-url" className="text-xs">Endpoint URL</Label>
                    <Input
                      id="webhook-url"
                      placeholder="https://your-server.com/omnecor/webhook"
                      value={ms.webhookUrl}
                      onChange={e => setMs({ webhookUrl: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="webhook-secret" className="text-xs">Signing Secret (optional)</Label>
                    <Input
                      id="webhook-secret"
                      type="password"
                      placeholder="Used to verify HMAC signature on incoming requests"
                      value={ms.webhookSecret}
                      onChange={e => setMs({ webhookSecret: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                </div>
              )}

              {active && ch.value === "n8n" && (
                <div className="px-3 pb-3 pt-1 border-t border-border/50">
                  <div className="space-y-1.5">
                    <Label htmlFor="n8n-workflow" className="text-xs">n8n Workflow ID</Label>
                    <Input
                      id="n8n-workflow"
                      placeholder="e.g. abc123-workflow-id"
                      value={ms.n8nWorkflowId}
                      onChange={e => setMs({ n8nWorkflowId: e.target.value })}
                      className="text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Messages to this agent will trigger the specified n8n workflow via the configured webhook URL.
                    </p>
                  </div>
                </div>
              )}

              {active && ch.value === "email" && (
                <div className="px-3 pb-3 pt-1 border-t border-border/50">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-address" className="text-xs">Email Address</Label>
                    <Input
                      id="email-address"
                      type="email"
                      placeholder="agent@yourdomain.com"
                      value={ms.emailAddress}
                      onChange={e => setMs({ emailAddress: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                </div>
              )}

              {active && ch.value === "in_app_chat" && (
                <div className="px-3 pb-3 pt-1 border-t border-border/50">
                  <a
                    href="/chat"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open Chat with {persona.name || "this persona"} active
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentConfigTab({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
}) {
  const [toolInput, setToolInput] = useState("");

  const addTool = () => {
    const t = toolInput.trim();
    if (!t || persona.agentTools.includes(t)) return;
    onChange({ agentTools: [...persona.agentTools, t] });
    setToolInput("");
  };

  const SUGGESTED_TOOLS = [
    "web_search", "code_executor", "file_reader", "image_gen", "tts_synthesize",
    "calendar", "email", "database_query",
  ];

  return (
    <div className="space-y-5">
      {persona.type !== "agent" && (
        <div className="rounded-md border border-muted px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          Switch persona type to <strong className="text-foreground mx-1">Omnecor Agent</strong> in the Identity tab to use agent configuration.
        </div>
      )}

      <div className={persona.type !== "agent" ? "opacity-40 pointer-events-none" : ""}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="agent-system-prompt">System Prompt</Label>
            <Textarea
              id="agent-system-prompt"
              placeholder="You are [Persona Name], a specialized AI assistant. Your expertise is in…"
              className="min-h-[140px] resize-none font-mono text-xs"
              value={persona.agentSystemPrompt}
              onChange={e => onChange({ agentSystemPrompt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              This prompt is injected at the top of every conversation this agent persona participates in.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Enabled Tools</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SUGGESTED_TOOLS.map(t => (
                <button
                  key={t}
                  onClick={() => {
                    if (persona.agentTools.includes(t)) {
                      onChange({ agentTools: persona.agentTools.filter(x => x !== t) });
                    } else {
                      onChange({ agentTools: [...persona.agentTools, t] });
                    }
                  }}
                  className={`text-xs rounded-full px-2.5 py-1 transition-colors border
                    ${persona.agentTools.includes(t)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Custom tool name…"
                value={toolInput}
                onChange={e => setToolInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTool(); } }}
              />
              <Button variant="outline" size="sm" onClick={addTool} disabled={!toolInput.trim()}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Always-On + Model backend */}
          <AlwaysOnModelSection persona={persona} onChange={onChange} />

          <Separator />

          {/* Messaging channels */}
          <MessagingChannelsSection persona={persona} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persona library card
// ---------------------------------------------------------------------------

function PersonaLibraryCard({
  persona,
  onLoad,
  onDelete,
}: {
  persona: Persona;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const typeOpt = TYPE_OPTIONS.find(t => t.value === persona.type)!;

  return (
    <div className="group relative rounded-xl border bg-card hover:border-primary transition-colors overflow-hidden">
      <div className="aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
        {persona.avatarDataUrl ? (
          <img src={persona.avatarDataUrl} alt={persona.name} className="w-full h-full object-cover" />
        ) : (
          <UserCircle2 className="w-12 h-12 text-muted-foreground opacity-30" />
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-medium truncate">{persona.name}</p>
        <Badge variant="secondary" className="text-[10px] gap-1">
          {typeOpt.icon}
          {typeOpt.label}
        </Badge>
        {persona.traits.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {persona.traits.join(", ")}
          </p>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex gap-1 p-2 bg-background/90 backdrop-blur-sm translate-y-full group-hover:translate-y-0 transition-transform">
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onLoad}>
          <Copy className="w-3 h-3 mr-1" />
          Load
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          aria-label="Delete persona"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

const PERSONA_MIGRATED_KEY = "omnecor_personas_migrated_v1";

const PersonaCreationPanel: React.FC = () => {
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas());
  const [current, setCurrent] = useState<Persona>(() => emptyPersona());
  const [isSaving, setIsSaving] = useState(false);

  const utils = trpc.useUtils();
  const dbPersonasQuery = trpc.personas.list.useQuery(undefined, { retry: false });
  const upsertMutation = trpc.personas.upsert.useMutation({
    onSuccess: () => utils.personas.list.invalidate(),
    onError: (err) => toast.error("Save failed: " + err.message),
  });
  const deleteMutation = trpc.personas.delete.useMutation({
    onSuccess: () => utils.personas.list.invalidate(),
    onError: (err) => toast.error("Delete failed: " + err.message),
  });
  const migrateMutation = trpc.personas.migrate.useMutation({
    onError: (err) => toast.error("Migration failed: " + err.message),
  });

  // Prefer DB data when available; keep localStorage as offline cache
  useEffect(() => {
    if (dbPersonasQuery.data && dbPersonasQuery.data.length > 0) {
      const dbList = dbPersonasQuery.data as unknown as Persona[];
      setPersonas(dbList);
      savePersonas(dbList);
    }
  }, [dbPersonasQuery.data]);

  // One-time migration from localStorage → DB
  useEffect(() => {
    if (localStorage.getItem(PERSONA_MIGRATED_KEY)) return;
    const local = loadPersonas();
    if (local.length === 0) { localStorage.setItem(PERSONA_MIGRATED_KEY, "true"); return; }
    migrateMutation.mutate(
      local.map(p => ({ id: p.id, name: p.name, type: p.type, alwaysOn: p.alwaysOn, data: p as unknown as Record<string, unknown> })),
      { onSuccess: () => localStorage.setItem(PERSONA_MIGRATED_KEY, "true") }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep localStorage in sync as offline cache
  useEffect(() => { savePersonas(personas); }, [personas]);

  const handleChange = useCallback((updates: Partial<Persona>) => {
    setCurrent(prev => ({ ...prev, ...updates }));
  }, []);

  const handleSave = async () => {
    if (!current.name.trim()) { toast.error("Give your persona a name first"); return; }
    setIsSaving(true);
    // Persist to DB (non-blocking)
    upsertMutation.mutate({
      id: current.id,
      name: current.name,
      type: current.type,
      alwaysOn: current.alwaysOn,
      data: current as unknown as Record<string, unknown>,
    });
    setPersonas(prev => {
      const idx = prev.findIndex(p => p.id === current.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = current;
        return next;
      }
      return [current, ...prev];
    });
    setIsSaving(false);
    toast.success(`Persona "${current.name}" saved`);
  };

  const handleClear = () => {
    setCurrent(emptyPersona());
    toast("Started new persona");
  };

  const handleLoad = (p: Persona) => {
    setCurrent({ ...p });
    toast(`Loaded "${p.name}"`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate({ id });
    setPersonas(prev => prev.filter(p => p.id !== id));
    if (current.id === id) setCurrent(emptyPersona());
    toast("Persona deleted");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-accent/20">
          <User className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Character Persona Studio</h2>
          <p className="text-sm text-muted-foreground">
            Build a digital clone of yourself, a social media persona, or a custom Omnecor AI agent — complete with voice, appearance, and behavior.
          </p>
        </div>
      </div>

      {/* Editor — 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
        {/* Left: preview card */}
        <PersonaPreviewCard
          persona={current}
          onSave={handleSave}
          onClear={handleClear}
          isSaving={isSaving}
        />

        {/* Right: tabbed editor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configure Persona</CardTitle>
            <CardDescription>
              Complete each section to define how this persona looks, sounds, and behaves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="identity">
              <TabsList className="w-full grid grid-cols-4 mb-5">
                <TabsTrigger value="identity" className="text-xs gap-1.5">
                  <UserCircle2 className="w-3.5 h-3.5" />
                  Identity
                </TabsTrigger>
                <TabsTrigger value="appearance" className="text-xs gap-1.5">
                  <Camera className="w-3.5 h-3.5" />
                  Appearance
                </TabsTrigger>
                <TabsTrigger value="voice" className="text-xs gap-1.5">
                  <Mic className="w-3.5 h-3.5" />
                  Voice
                </TabsTrigger>
                <TabsTrigger value="video" className="text-xs gap-1.5">
                  <Video className="w-3.5 h-3.5" />
                  Video
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[520px] pr-1">
                <TabsContent value="identity" className="mt-0 pr-2">
                  <IdentityTab persona={current} onChange={handleChange} />
                </TabsContent>

                <TabsContent value="appearance" className="mt-0 pr-2">
                  <AppearanceTab persona={current} onChange={handleChange} />
                </TabsContent>

                <TabsContent value="voice" className="mt-0 pr-2">
                  <VoiceTab persona={current} onChange={handleChange} />
                </TabsContent>

                <TabsContent value="video" className="mt-0 pr-2">
                  <VideoAvatarTab persona={current} onChange={handleChange} />
                </TabsContent>
              </ScrollArea>
            </Tabs>

            {/* Agent config as expandable section below main tabs */}
            {current.type === "agent" && (
              <div className="mt-5 pt-5 border-t">
                <div className="flex items-center gap-2 mb-4">
                  <Brain className="w-4 h-4 text-accent" />
                  <p className="text-sm font-semibold">Agent Configuration</p>
                </div>
                <AgentConfigTab persona={current} onChange={handleChange} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Persona library */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Persona Library</h3>
            <p className="text-xs text-muted-foreground">{personas.length} saved persona{personas.length !== 1 ? "s" : ""}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Persona
          </Button>
        </div>

        {personas.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-muted/10 flex flex-col items-center justify-center gap-3 py-14 text-center">
            <UserCircle2 className="w-12 h-12 text-muted-foreground opacity-20" />
            <div>
              <p className="text-sm text-muted-foreground font-medium">No personas yet</p>
              <p className="text-xs text-muted-foreground">Fill out the form above and click Save Persona.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {personas.map(p => (
              <PersonaLibraryCard
                key={p.id}
                persona={p}
                onLoad={() => handleLoad(p)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonaCreationPanel;
