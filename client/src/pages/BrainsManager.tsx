/**
 * Brains Manager — portable "external brain" management surface
 * (Brains-Upgrade Phase 8).
 *
 * The management home for `.obp` Brain Packs: list every brain with a live
 * health + embedder-match indicator, import (built-ins or a `.obp` file), export
 * back to a `.obp`, rebuild the vector index, delete, sync a pack to a mesh peer
 * (Phase 7), and durably attach/detach a brain to a persona (Phase 4). It sits
 * beside the Neural Brain Map (personal, writable knowledge) as the read-only,
 * curated, model-agnostic knowledge surface.
 *
 * All calls are local tRPC (`brains.*`, `personas.*`, `ommesh.*`) — the whole
 * page works air-gapped in Sovereign mode. Follows Context/UI-Rules.md +
 * Context/UI-Tokens.md (semantic landmarks, unique ids, hover transitions,
 * .card-content-safe text wrapping).
 */
import { useMemo, useRef, useState } from "react";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HowToTooltip } from "@/components/shell/HowToTooltip";
import {
  BrainCircuit,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  Share2,
  PackagePlus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Link2,
  Link2Off,
  Puzzle,
} from "lucide-react";

/** Serialized brain shape returned by `brains.list`. */
interface BrainRow {
  id: string;
  name: string;
  version: string;
  domain: string;
  description: string | null;
  status: "ready" | "incompatible" | "error";
  embedderId: string;
  embedderDim: number;
  embedderMatch: boolean;
  chunkCount: number;
  provenance: Record<string, unknown> | null;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Status → (label, badge variant, icon) for the health indicator. */
function statusDisplay(status: BrainRow["status"]) {
  switch (status) {
    case "ready":
      return { label: "Ready", className: "border-transparent bg-accent-success/15 text-accent-success", Icon: CheckCircle2 };
    case "incompatible":
      return { label: "Incompatible", className: "border-transparent bg-amber-500/15 text-amber-500", Icon: AlertTriangle };
    default:
      return { label: "Error", className: "border-transparent bg-destructive/15 text-destructive", Icon: XCircle };
  }
}

export function BrainsManager() {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: brains = [], isLoading } = trpc.brains.list.useQuery();
  const { data: personas = [] } = trpc.personas.list.useQuery();
  const { data: peers = [] } = trpc.ommesh.discover.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [syncTarget, setSyncTarget] = useState<BrainRow | null>(null);
  const [syncPeerId, setSyncPeerId] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    void utils.brains.list.invalidate();
  };

  // ─── mutations ────────────────────────────────────────────────────────────
  const importBuiltins = trpc.brains.importBuiltins.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.imported.length ? `Imported ${r.imported.length} built-in brain(s)` : "Built-in brains already imported",
      );
      refresh();
    },
    onError: (e) => toast.error(`Import failed: ${e.message}`),
  });

  const importFile = trpc.brains.import.useMutation({
    onSuccess: (r) => {
      if (r.embedderMatch) {
        toast.success(`Imported "${r.brain?.name}" — ${r.vectorsLoaded} chunks indexed`);
      } else {
        toast.warning(`Imported "${r.brain?.name}" as incompatible — charter kept, corpus not indexed`);
      }
      refresh();
    },
    onError: (e) => toast.error(`Import failed: ${e.message}`),
  });

  const exportBrain = trpc.brains.export.useMutation({
    onError: (e) => toast.error(`Export failed: ${e.message}`),
  });

  const deleteBrain = trpc.brains.delete.useMutation({
    onSuccess: () => {
      toast.success("Brain deleted");
      refresh();
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  const rebuildIndex = trpc.brains.rebuildIndex.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.status === "ready"
          ? `Index rebuilt — ${r.vectorsLoaded} chunks loaded`
          : "Rebuilt: still embedder-incompatible (corpus not indexed)",
      );
      refresh();
    },
    onError: (e) => toast.error(`Rebuild failed: ${e.message}`),
  });

  const syncToPeer = trpc.brains.syncToPeer.useMutation({
    onSuccess: (r) => {
      if (r.embedderMatch) {
        toast.success(`Synced "${r.brainId}" to ${r.peerId} — ready & indexed there`);
      } else {
        toast.warning(`Synced "${r.brainId}" to ${r.peerId} — incompatible embedder there (charter only)`);
      }
      setSyncTarget(null);
      setSyncPeerId("");
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });

  const attachBrain = trpc.personas.attachBrain.useMutation({
    onSuccess: () => {
      toast.success("Brain attached to persona");
      void utils.personas.list.invalidate();
    },
    onError: (e) => toast.error(`Attach failed: ${e.message}`),
  });
  const detachBrain = trpc.personas.detachBrain.useMutation({
    onSuccess: () => {
      toast.success("Brain detached from persona");
      void utils.personas.list.invalidate();
    },
    onError: (e) => toast.error(`Detach failed: ${e.message}`),
  });

  // ─── derived ─────────────────────────────────────────────────────────────
  const selectedPersona = useMemo(
    () => (personas as Array<Record<string, unknown>>).find((p) => p.id === selectedPersonaId),
    [personas, selectedPersonaId],
  );
  const attachedBrainIds = useMemo<string[]>(() => {
    const raw = (selectedPersona?.brains as unknown) ?? [];
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [selectedPersona]);

  // ─── handlers ────────────────────────────────────────────────────────────
  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.name.endsWith(".obp")) {
      toast.error("Select a .obp Brain Pack file");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      // Chunked base64 (avoid a huge spread that can overflow the call stack).
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      }
      importFile.mutate({ data: btoa(binary), filename: file.name });
    } catch (err) {
      toast.error(`Could not read file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onExport = async (brain: BrainRow) => {
    setBusyId(brain.id);
    try {
      const res = await exportBrain.mutateAsync({ brainId: brain.id });
      const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusyId(null);
    }
  };

  const openSync = (brain: BrainRow) => {
    setSyncTarget(brain);
    setSyncPeerId(peers[0]?.name ?? "");
  };

  const brainList = (brains as Array<BrainRow | null>).filter((b): b is BrainRow => b !== null);

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <header className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrainCircuit className="w-6 h-6 text-accent-purple flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">Brains</h1>
                <p className="text-sm text-muted-foreground truncate">
                  Portable external knowledge packs — attach domain expertise to any local model
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HowToTooltip title="Built-in brains" description="Import the expert brains shipped with Omnecor (Coding, Software Architect, PCB, and more).">
                <Button
                  id="btn-brains-import-builtins"
                  variant="outline"
                  size="sm"
                  onClick={() => importBuiltins.mutate()}
                  disabled={importBuiltins.isPending}
                  className="gap-2 transition-colors"
                >
                  {importBuiltins.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                  Built-ins
                </Button>
              </HowToTooltip>
              <Button
                id="btn-brains-import-file"
                size="sm"
                onClick={onPickFile}
                disabled={importFile.isPending}
                className="gap-2 transition-colors"
              >
                {importFile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import .obp
              </Button>
              <input
                ref={fileInputRef}
                id="input-brains-file"
                type="file"
                accept=".obp"
                onChange={onFileChange}
                className="hidden"
              />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Persona attach selector */}
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link2 className="w-4 h-4" />
              <span>Attach to persona:</span>
            </div>
            <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
              <SelectTrigger id="select-brains-persona" className="w-64 cursor-pointer">
                <SelectValue placeholder="Choose a persona to manage its brains…" />
              </SelectTrigger>
              <SelectContent>
                {(personas as Array<Record<string, unknown>>).length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No personas yet</div>
                ) : (
                  (personas as Array<Record<string, unknown>>).map((p) => (
                    <SelectItem key={String(p.id)} value={String(p.id)}>
                      {String(p.name)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedPersonaId && (
              <span className="text-xs text-muted-foreground">
                {attachedBrainIds.length} brain{attachedBrainIds.length === 1 ? "" : "s"} attached — toggle on any card below
              </span>
            )}
          </section>

          {/* Brain list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading brains…
            </div>
          ) : brainList.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                <BrainCircuit className="w-10 h-10 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold">No brains yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md card-content-safe">
                    Import the built-in expert brains, or bring your own <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">.obp</code> pack.
                    A brain gives a small local model curated domain expertise without retraining it.
                  </p>
                </div>
                <Button id="btn-brains-empty-import-builtins" onClick={() => importBuiltins.mutate()} disabled={importBuiltins.isPending} className="gap-2">
                  <PackagePlus className="w-4 h-4" /> Import built-in brains
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {brainList.map((brain) => {
                const s = statusDisplay(brain.status);
                const attached = attachedBrainIds.includes(brain.id);
                const rowBusy = busyId === brain.id;
                return (
                  <Card
                    key={brain.id}
                    className={cn(
                      "flex flex-col transition-colors hover:bg-bg-elevated/40 max-w-full",
                      attached && "ring-1 ring-accent-purple/60",
                    )}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base truncate card-content-safe" title={brain.name}>
                          {brain.name}
                        </CardTitle>
                        <Badge className={cn("gap-1 shrink-0", s.className)}>
                          <s.Icon className="w-3 h-3" />
                          {s.label}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <Badge variant="secondary" className="text-xs">{brain.domain}</Badge>
                        <Badge variant="outline" className="text-xs">v{brain.version}</Badge>
                        {brain.builtin && <Badge variant="outline" className="text-xs">built-in</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                      {brain.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 card-content-safe">{brain.description}</p>
                      )}

                      {/* Health / embedder-match indicator */}
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Chunks</span>
                          <span className="font-mono">{brain.chunkCount}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Embedder</span>
                          <span className="flex items-center gap-1 min-w-0">
                            {brain.embedderMatch ? (
                              <CheckCircle2 className="w-3 h-3 text-accent-success shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                            )}
                            <span className="font-mono truncate card-content-safe" title={`${brain.embedderId} · ${brain.embedderDim}d`}>
                              {brain.embedderId}
                            </span>
                          </span>
                        </div>
                        {!brain.embedderMatch && (
                          <p className="text-amber-500 card-content-safe">
                            Embedder mismatch — corpus not indexed. Charter still applies; rebuild after switching embedders.
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="mt-auto flex flex-wrap items-center gap-1.5">
                        {selectedPersonaId && (
                          <Button
                            id={`btn-brain-attach-${brain.id}`}
                            variant={attached ? "secondary" : "outline"}
                            size="sm"
                            className="gap-1.5 transition-colors"
                            disabled={attachBrain.isPending || detachBrain.isPending}
                            onClick={() =>
                              attached
                                ? detachBrain.mutate({ personaId: selectedPersonaId, brainId: brain.id })
                                : attachBrain.mutate({ personaId: selectedPersonaId, brainId: brain.id })
                            }
                          >
                            {attached ? <Link2Off className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                            {attached ? "Detach" : "Attach"}
                          </Button>
                        )}
                        <Button
                          id={`btn-brain-export-${brain.id}`}
                          variant="outline"
                          size="sm"
                          className="gap-1.5 transition-colors"
                          disabled={rowBusy}
                          onClick={() => onExport(brain)}
                        >
                          {rowBusy && exportBrain.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Export
                        </Button>
                        <Button
                          id={`btn-brain-sync-${brain.id}`}
                          variant="outline"
                          size="sm"
                          className="gap-1.5 transition-colors"
                          onClick={() => openSync(brain)}
                        >
                          <Share2 className="w-3.5 h-3.5" /> Sync
                        </Button>
                        {!brain.embedderMatch && (
                          <Button
                            id={`btn-brain-rebuild-${brain.id}`}
                            variant="outline"
                            size="sm"
                            className="gap-1.5 transition-colors"
                            disabled={rebuildIndex.isPending}
                            onClick={() => rebuildIndex.mutate({ brainId: brain.id })}
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Rebuild
                          </Button>
                        )}
                        <Button
                          id={`btn-brain-delete-${brain.id}`}
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                          disabled={deleteBrain.isPending}
                          onClick={() => {
                            if (confirm(`Delete brain "${brain.name}"? This removes its corpus and vector index.`)) {
                              deleteBrain.mutate({ brainId: brain.id });
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Sync-to-peer dialog */}
      <Dialog open={!!syncTarget} onOpenChange={(o) => !o && setSyncTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-accent-cyan" /> Sync brain to a mesh peer
            </DialogTitle>
            <DialogDescription className="card-content-safe">
              Push <span className="font-semibold text-foreground">{syncTarget?.name}</span> to another Omnecor node over
              the encrypted mesh. The peer verifies embedder compatibility on receive.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {peers.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Puzzle className="w-4 h-4" /> No mesh peers are currently online.
              </div>
            ) : (
              <Select value={syncPeerId} onValueChange={setSyncPeerId}>
                <SelectTrigger id="select-brain-sync-peer" className="cursor-pointer">
                  <SelectValue placeholder="Choose a peer node…" />
                </SelectTrigger>
                <SelectContent>
                  {peers.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name} <span className="text-muted-foreground">({p.address})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncTarget(null)}>Cancel</Button>
            <Button
              id="btn-brain-sync-confirm"
              className="gap-2"
              disabled={!syncPeerId || syncToPeer.isPending}
              onClick={() => syncTarget && syncToPeer.mutate({ brainId: syncTarget.id, peerId: syncPeerId })}
            >
              {syncToPeer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              Push to peer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OmnecorDashboardLayout>
  );
}
