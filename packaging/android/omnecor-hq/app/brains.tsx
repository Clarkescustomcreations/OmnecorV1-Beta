/**
 * Brains Manager (mobile) — portable "external brain" management surface
 * (Brains-Upgrade Phase 8). Native port of `client/src/pages/BrainsManager.tsx`.
 *
 * Manage `.obp` Brain Packs: list with health + embedder-match, import (built-ins
 * or a `.obp` file), export back to a `.obp`, rebuild the vector index, delete,
 * sync a pack to a mesh peer, and durably attach/detach a brain to a persona.
 * All calls are local tRPC via the untyped `trpcQuery`/`trpcMutate` helpers, so
 * the whole screen works air-gapped in Sovereign mode.
 */
import { View, Text, ScrollView, ActivityIndicator, Alert, Modal, RefreshControl } from "react-native";
import { Pressable } from "@/components/pressable";
import { useCallback, useEffect, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { isServerConfigured } from "@/lib/_core/server-config";
import { saveBase64File } from "@/lib/_core/file-export";

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
  builtin: boolean;
}
interface PersonaRow { id: string; name: string; brains?: string[] }
interface PeerRow { name: string; address?: string }

function statusMeta(status: BrainRow["status"]) {
  switch (status) {
    case "ready": return { label: "Ready", cls: "bg-success/15 text-success", icon: "✅" };
    case "incompatible": return { label: "Incompatible", cls: "bg-warning/15 text-warning", icon: "⚠️" };
    default: return { label: "Error", cls: "bg-destructive/15 text-destructive", icon: "⛔" };
  }
}

export default function BrainsScreen() {
  const colors = useColors();
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // action label while a mutation runs
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [syncTarget, setSyncTarget] = useState<BrainRow | null>(null);

  const load = useCallback(async (soft = false) => {
    if (!isServerConfigured()) { setLoading(false); return; }
    if (!soft) setLoading(true);
    try {
      const [b, p, pe] = await Promise.all([
        trpcQuery<(BrainRow | null)[]>("brains.list").catch((): (BrainRow | null)[] => []),
        trpcQuery<PersonaRow[]>("personas.list").catch((): PersonaRow[] => []),
        trpcQuery<PeerRow[]>("ommesh.discover").catch((): PeerRow[] => []),
      ]);
      setBrains(b.filter((x): x is BrainRow => x !== null));
      setPersonas(p);
      setPeers(pe);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const attachedIds: string[] = Array.isArray(selectedPersona?.brains) ? selectedPersona!.brains! : [];

  // ── actions ────────────────────────────────────────────────────────────────
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { Alert.alert("Failed", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }, []);

  const importBuiltins = () => run("builtins", async () => {
    const r = await trpcMutate<{ imported: string[] }>("brains.importBuiltins", null);
    Alert.alert("Built-in brains", r.imported.length ? `Imported ${r.imported.length} brain(s).` : "Built-in brains already imported.");
    await load(true);
  });

  const importFile = () => run("import", async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: "*/*" });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset.name.toLowerCase().endsWith(".obp")) { Alert.alert("Wrong file", "Select a .obp Brain Pack file."); return; }
    const data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    const r = await trpcMutate<{ brain: { name: string } | null; embedderMatch: boolean; vectorsLoaded: number }>("brains.import", { data, filename: asset.name });
    Alert.alert("Imported", r.embedderMatch
      ? `"${r.brain?.name}" — ${r.vectorsLoaded} chunks indexed.`
      : `"${r.brain?.name}" imported as incompatible — charter kept, corpus not indexed.`);
    await load(true);
  });

  const exportBrain = (brain: BrainRow) => run(`export-${brain.id}`, async () => {
    const r = await trpcMutate<{ filename: string; data: string }>("brains.export", { brainId: brain.id });
    const saved = await saveBase64File(r.data, r.filename, "application/octet-stream");
    if (saved.ok) Alert.alert("Exported", `Saved ${r.filename}.`);
    else if (saved.reason !== "cancelled") Alert.alert("Export failed", saved.message ?? "Could not save the file.");
  });

  const rebuild = (brain: BrainRow) => run(`rebuild-${brain.id}`, async () => {
    const r = await trpcMutate<{ status: string; vectorsLoaded: number }>("brains.rebuildIndex", { brainId: brain.id });
    Alert.alert("Rebuilt", r.status === "ready" ? `${r.vectorsLoaded} chunks loaded.` : "Still embedder-incompatible (corpus not indexed).");
    await load(true);
  });

  const del = (brain: BrainRow) => Alert.alert(
    "Delete brain",
    `Delete "${brain.name}"? This removes its corpus and vector index.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => run(`delete-${brain.id}`, async () => {
        await trpcMutate("brains.delete", { brainId: brain.id });
        await load(true);
      }) },
    ],
  );

  const doSync = (brain: BrainRow, peerName: string) => run(`sync-${brain.id}`, async () => {
    const r = await trpcMutate<{ peerId: string; embedderMatch?: boolean }>("brains.syncToPeer", { brainId: brain.id, peerId: peerName });
    setSyncTarget(null);
    Alert.alert("Synced", r.embedderMatch === false
      ? `Sent to ${peerName} — incompatible embedder there (charter only).`
      : `Sent to ${peerName} — ready & indexed there.`);
  });

  const toggleAttach = (brain: BrainRow) => {
    if (!selectedPersonaId) return;
    const attached = attachedIds.includes(brain.id);
    void run(`attach-${brain.id}`, async () => {
      const r = await trpcMutate<{ brains: string[] }>(attached ? "personas.detachBrain" : "personas.attachBrain", { personaId: selectedPersonaId, brainId: brain.id });
      setPersonas((prev) => prev.map((p) => (p.id === selectedPersonaId ? { ...p, brains: r.brains } : p)));
    });
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
        <Pressable testID="btn-brains-back" onPress={() => router.back()} className="w-9 h-9 items-center justify-center rounded-lg active:opacity-60">
          <Text className="text-foreground text-xl">‹</Text>
        </Pressable>
        <View className="flex-1 min-w-0">
          <Text className="text-lg font-bold text-foreground">Brains</Text>
          <Text className="text-xs text-muted" numberOfLines={1}>Portable knowledge packs — domain expertise for any local model</Text>
        </View>
      </View>

      {/* Import actions */}
      <View className="flex-row gap-2 px-4 py-2 border-b border-border">
        <Pressable testID="btn-brains-import-builtins" disabled={!!busy} onPress={importBuiltins}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-border bg-surface py-2.5 active:opacity-60">
          {busy === "builtins" ? <ActivityIndicator size="small" /> : <Text className="text-sm">📦</Text>}
          <Text className="text-sm font-semibold text-foreground">Built-ins</Text>
        </Pressable>
        <Pressable testID="btn-brains-import-file" disabled={!!busy} onPress={importFile}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 active:opacity-60">
          {busy === "import" ? <ActivityIndicator size="small" color={colors.background} /> : <Text className="text-sm">⬆️</Text>}
          <Text className="text-sm font-semibold text-background">Import .obp</Text>
        </Pressable>
      </View>

      {/* Persona attach selector */}
      <View className="flex-row items-center gap-2 px-4 py-2 border-b border-border">
        <Text className="text-xs text-muted">Attach to persona:</Text>
        <Pressable testID="btn-brains-persona-picker" onPress={() => setPersonaPickerOpen(true)} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 active:opacity-60">
          <Text className="text-sm text-foreground" numberOfLines={1}>{selectedPersona ? selectedPersona.name : "Choose a persona…"}</Text>
        </Pressable>
        {selectedPersonaId && (
          <Pressable testID="btn-brains-persona-clear" onPress={() => setSelectedPersonaId(null)} className="px-2 py-1 active:opacity-60">
            <Text className="text-xs text-muted">Clear</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />}
        >
          {brains.length === 0 ? (
            <View className="items-center justify-center py-16 gap-3">
              <Text className="text-4xl">🧠</Text>
              <Text className="text-base font-semibold text-foreground">No brains yet</Text>
              <Text className="text-sm text-muted text-center px-6">
                Import the built-in expert brains, or bring your own .obp pack. A brain gives a small local model curated domain expertise without retraining it.
              </Text>
            </View>
          ) : brains.map((brain) => {
            const s = statusMeta(brain.status);
            const attached = !!selectedPersonaId && attachedIds.includes(brain.id);
            const rowBusy = busy?.endsWith(brain.id) ?? false;
            return (
              <View key={brain.id} className={`rounded-xl border p-3 gap-2 ${attached ? "border-accent bg-accent/5" : "border-border bg-card"}`}>
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>{brain.name}</Text>
                  <View className={`flex-row items-center gap-1 rounded-md px-2 py-0.5 ${s.cls}`}>
                    <Text className="text-xs">{s.icon}</Text>
                    <Text className="text-xs font-semibold">{s.label}</Text>
                  </View>
                </View>
                <View className="flex-row flex-wrap gap-1.5">
                  <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{brain.domain}</Text>
                  <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">v{brain.version}</Text>
                  {brain.builtin && <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">built-in</Text>}
                  <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{brain.chunkCount} chunks</Text>
                </View>
                {brain.description ? <Text className="text-xs text-muted" numberOfLines={2}>{brain.description}</Text> : null}
                {!brain.embedderMatch && (
                  <Text className="text-[11px] text-warning">Embedder mismatch ({brain.embedderId}) — corpus not indexed. Charter still applies; rebuild after switching embedders.</Text>
                )}

                {/* Actions */}
                <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
                  {selectedPersonaId && (
                    <Pressable testID={`btn-brain-attach-${brain.id}`} disabled={!!busy} onPress={() => toggleAttach(brain)}
                      className={`rounded-lg px-2.5 py-1.5 active:opacity-60 ${attached ? "bg-accent/15" : "border border-border bg-surface"}`}>
                      <Text className={`text-xs font-semibold ${attached ? "text-accent" : "text-foreground"}`}>{attached ? "Detach" : "Attach"}</Text>
                    </Pressable>
                  )}
                  <Pressable testID={`btn-brain-export-${brain.id}`} disabled={!!busy} onPress={() => exportBrain(brain)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 active:opacity-60">
                    <Text className="text-xs font-semibold text-foreground">Export</Text>
                  </Pressable>
                  <Pressable testID={`btn-brain-sync-${brain.id}`} disabled={!!busy} onPress={() => setSyncTarget(brain)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 active:opacity-60">
                    <Text className="text-xs font-semibold text-foreground">Sync</Text>
                  </Pressable>
                  {!brain.embedderMatch && (
                    <Pressable testID={`btn-brain-rebuild-${brain.id}`} disabled={!!busy} onPress={() => rebuild(brain)}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 active:opacity-60">
                      <Text className="text-xs font-semibold text-foreground">Rebuild</Text>
                    </Pressable>
                  )}
                  <Pressable testID={`btn-brain-delete-${brain.id}`} disabled={!!busy} onPress={() => del(brain)}
                    className="ml-auto rounded-lg px-2.5 py-1.5 active:opacity-60">
                    <Text className="text-xs font-semibold text-destructive">Delete</Text>
                  </Pressable>
                  {rowBusy && <ActivityIndicator size="small" />}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Persona picker modal */}
      <Modal visible={personaPickerOpen} transparent animationType="fade" onRequestClose={() => setPersonaPickerOpen(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setPersonaPickerOpen(false)}>
          <Pressable className="bg-card rounded-t-2xl border-t border-border p-4 gap-2" onPress={() => {}}>
            <Text className="text-base font-bold text-foreground mb-1">Attach to persona</Text>
            {personas.length === 0 ? (
              <Text className="text-sm text-muted py-3">No personas on the PC yet — create one in the desktop app.</Text>
            ) : personas.map((p) => (
              <Pressable key={p.id} testID={`item-persona-${p.id}`} onPress={() => { setSelectedPersonaId(p.id); setPersonaPickerOpen(false); }}
                className={`rounded-lg px-3 py-3 ${p.id === selectedPersonaId ? "bg-primary/10" : ""} active:opacity-60`}>
                <Text className={`text-sm ${p.id === selectedPersonaId ? "text-primary font-semibold" : "text-foreground"}`}>{p.name}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sync-to-peer modal */}
      <Modal visible={!!syncTarget} transparent animationType="fade" onRequestClose={() => setSyncTarget(null)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setSyncTarget(null)}>
          <Pressable className="bg-card rounded-t-2xl border-t border-border p-4 gap-2" onPress={() => {}}>
            <Text className="text-base font-bold text-foreground">{`Sync "${syncTarget?.name ?? ""}" to a mesh peer`}</Text>
            <Text className="text-xs text-muted mb-1">The peer verifies embedder compatibility on receive.</Text>
            {peers.length === 0 ? (
              <Text className="text-sm text-muted py-3">No mesh peers are currently online.</Text>
            ) : peers.map((p) => (
              <Pressable key={p.name} testID={`item-sync-peer-${p.name}`} onPress={() => syncTarget && doSync(syncTarget, p.name)}
                className="rounded-lg border border-border bg-surface px-3 py-3 active:opacity-60">
                <Text className="text-sm text-foreground">{p.name}{p.address ? <Text className="text-muted">  ({p.address})</Text> : null}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
