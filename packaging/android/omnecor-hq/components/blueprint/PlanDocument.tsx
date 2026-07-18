/**
 * PlanDocument (mobile) — read-only Build Plan viewer for Blueprint Studio.
 *
 * A Core-depth native port of the web `PlanTabs.tsx`: it renders the persisted
 * plan document — Overview, BOM, Cut List, Steps and Files — as read-only
 * sections (editing BOM/cut/geometry stays on the desktop). The heavy
 * engineering surfaces (drawings, 3D mesh, patterns, FEA) live in the Files list
 * and the exported PDF; a note points there. Stored dimensional truth is mm; the
 * `fmtLen`/`fmtAngle` helpers mirror PlanTabs exactly.
 */
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
import { Pressable } from "@/components/pressable";
import { useEffect, useMemo, useState } from "react";

// ── Plan document shapes (mirror the desktop `blueprint.get` payload) ─────────
export interface BomItem {
  id: string; kind: string; name: string; spec: string; quantity: number; unit: string;
  unitCost: number | null; currency: string; supplier: string | null; url: string | null; notes: string | null;
}
export interface CutItem {
  id: string; partLabel: string; stockName: string; quantity: number;
  lengthMm: number | null; widthMm: number | null; thicknessMm: number | null;
  miter1Deg: number | null; bevel1Deg: number | null; miter2Deg: number | null; bevel2Deg: number | null;
  notes: string | null;
}
export interface PlanFile {
  id: string; kind: string; name: string; mimeType: string; sizeBytes: number | null; isLatest: boolean;
}
export interface AssemblyStep { title: string; detail: string; parts?: string[]; tools?: string[] }
export interface PlanRecord {
  id: string; title: string; brief: string; category: string; status: string;
  units: string; cadEngine: string; overview: string; safetyNotes: string;
  assemblySteps: AssemblyStep[] | null;
}
export interface PlanData {
  plan: PlanRecord;
  bomItems: BomItem[];
  cutItems: CutItem[];
  simResults: { id: string; kind: string; name: string; status: string }[];
  files: PlanFile[];
}

// ── Unit display helpers (stored truth is mm) — ported from PlanTabs ──────────
export function fmtLen(mm: number | null | undefined, units: string): string {
  if (mm === null || mm === undefined) return "—";
  if (units === "metric") return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  if (inches < 12) return `${inches.toFixed(2)}"`;
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  return rem < 0.05 ? `${ft}'` : `${ft}' ${rem.toFixed(1)}"`;
}
export const fmtAngle = (d: number | null | undefined) => (d === null || d === undefined || d === 0 ? "□" : `${d.toFixed(1)}°`);

type Section = "overview" | "bom" | "cutlist" | "steps" | "drawings" | "files";

/** File kinds we can render inline as vector graphics in a WebView. */
const SVG_KINDS = new Set(["drawing_svg", "pattern_svg"]);

export function PlanDocument({
  data,
  conceptDataUri,
  onOpenFile,
  getFileContent,
}: {
  data: PlanData;
  /** A `data:` URI for the newest concept image, shown in Overview if present. */
  conceptDataUri?: string | null;
  /** Save/open a plan file (drawing, mesh, pattern, PDF) via SAF. */
  onOpenFile: (file: PlanFile) => void;
  /** Fetch a file's bytes for inline SVG rendering. */
  getFileContent?: (fileId: string) => Promise<{ contentBase64: string; mimeType: string } | null>;
}) {
  const { plan } = data;
  const [section, setSection] = useState<Section>("overview");
  const bomTotal = useMemo(
    () => data.bomItems.reduce((s, i) => s + (i.unitCost ?? 0) * i.quantity, 0),
    [data.bomItems],
  );
  const steps = plan.assemblySteps ?? [];
  const svgFiles = useMemo(() => data.files.filter((f) => f.isLatest && SVG_KINDS.has(f.kind)), [data.files]);

  const chips: { key: Section; label: string; n?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "bom", label: "BOM", n: data.bomItems.length },
    { key: "cutlist", label: "Cut List", n: data.cutItems.length },
    { key: "steps", label: "Steps", n: steps.length },
    ...(getFileContent && svgFiles.length ? [{ key: "drawings" as const, label: "Drawings", n: svgFiles.length }] : []),
    { key: "files", label: "Files", n: data.files.length },
  ];

  return (
    <View className="flex-1">
      {/* Section chips */}
      <View className="border-b border-border">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
          {chips.map((c) => (
            <Pressable key={c.key} testID={`chip-plan-${c.key}`} onPress={() => setSection(c.key)}
              className={`rounded-full px-3 py-1.5 ${section === c.key ? "bg-primary" : "bg-surface border border-border"}`}>
              <Text className={`text-xs font-semibold ${section === c.key ? "text-background" : "text-foreground"}`}>
                {c.label}{c.n ? ` (${c.n})` : ""}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
        {section === "overview" && (
          <View className="gap-3">
            <View className="flex-row flex-wrap gap-1.5">
              <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{plan.category.replace("_", " ")}</Text>
              <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{plan.status}</Text>
              <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{plan.units}</Text>
              <Text className="text-[10px] rounded bg-surface border border-border px-1.5 py-0.5 text-muted">{plan.cadEngine}</Text>
            </View>
            {conceptDataUri ? (
              <Image source={{ uri: conceptDataUri }} style={{ width: "100%", height: 200, borderRadius: 10 }} contentFit="cover" />
            ) : null}
            {plan.brief ? (
              <View>
                <Text className="text-xs font-semibold text-muted mb-1">Brief</Text>
                <Text selectable className="text-sm text-foreground leading-5">{plan.brief}</Text>
              </View>
            ) : null}
            {plan.overview ? (
              <View>
                <Text className="text-xs font-semibold text-muted mb-1">Design overview</Text>
                <Text selectable className="text-sm text-foreground leading-5">{plan.overview}</Text>
              </View>
            ) : null}
            {plan.safetyNotes ? (
              <View className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                <Text className="text-xs font-semibold text-warning mb-1">⚠️ Safety</Text>
                <Text selectable className="text-sm text-foreground leading-5">{plan.safetyNotes}</Text>
              </View>
            ) : null}
            {!plan.brief && !plan.overview && (
              <Text className="text-sm text-muted">Describe your project in the planning chat — the agent fills in materials, cut lists, drawings and calcs here.</Text>
            )}
          </View>
        )}

        {section === "bom" && (
          data.bomItems.length === 0 ? <Empty label="No materials yet." /> : (
            <View className="gap-2">
              {data.bomItems.map((it) => (
                <View key={it.id} className="rounded-lg border border-border bg-card p-3">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-sm font-semibold text-foreground">{it.name}</Text>
                    <Text className="text-xs text-muted">{it.quantity} {it.unit}</Text>
                  </View>
                  {it.spec ? <Text className="text-xs text-muted mt-0.5">{it.spec}</Text> : null}
                  <View className="flex-row flex-wrap gap-2 mt-1">
                    <Text className="text-[11px] text-muted">{it.kind}</Text>
                    {it.unitCost != null ? <Text className="text-[11px] text-muted">{it.currency} {it.unitCost.toFixed(2)} ea</Text> : null}
                    {it.supplier ? <Text className="text-[11px] text-muted">· {it.supplier}</Text> : null}
                  </View>
                  {it.notes ? <Text className="text-[11px] text-muted mt-1">{it.notes}</Text> : null}
                </View>
              ))}
              {bomTotal > 0 && (
                <View className="flex-row justify-between px-1 pt-1">
                  <Text className="text-sm font-semibold text-foreground">Estimated total</Text>
                  <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                    {data.bomItems[0]?.currency ?? "USD"} {bomTotal.toFixed(2)}
                  </Text>
                </View>
              )}
            </View>
          )
        )}

        {section === "cutlist" && (
          data.cutItems.length === 0 ? <Empty label="No cut list yet." /> : (
            <View className="gap-2">
              {data.cutItems.map((c) => (
                <View key={c.id} className="rounded-lg border border-border bg-card p-3">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-sm font-semibold text-foreground">{c.partLabel}</Text>
                    <Text className="text-xs text-muted">×{c.quantity}</Text>
                  </View>
                  {c.stockName ? <Text className="text-xs text-muted mt-0.5">{c.stockName}</Text> : null}
                  <View className="flex-row flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <Text className="text-[11px] text-foreground">L {fmtLen(c.lengthMm, plan.units)}</Text>
                    {c.widthMm != null ? <Text className="text-[11px] text-foreground">W {fmtLen(c.widthMm, plan.units)}</Text> : null}
                    {c.thicknessMm != null ? <Text className="text-[11px] text-foreground">T {fmtLen(c.thicknessMm, plan.units)}</Text> : null}
                    <Text className="text-[11px] text-muted">miter {fmtAngle(c.miter1Deg)}/{fmtAngle(c.miter2Deg)}</Text>
                    <Text className="text-[11px] text-muted">bevel {fmtAngle(c.bevel1Deg)}/{fmtAngle(c.bevel2Deg)}</Text>
                  </View>
                  {c.notes ? <Text className="text-[11px] text-muted mt-1">{c.notes}</Text> : null}
                </View>
              ))}
            </View>
          )
        )}

        {section === "steps" && (
          steps.length === 0 ? <Empty label="No assembly steps yet." /> : (
            <View className="gap-2">
              {steps.map((s, i) => (
                <View key={i} className="rounded-lg border border-border bg-card p-3">
                  <Text className="text-sm font-semibold text-foreground">{i + 1}. {s.title}</Text>
                  {s.detail ? <Text selectable className="text-xs text-muted mt-1 leading-5">{s.detail}</Text> : null}
                  {s.parts?.length ? <Text className="text-[11px] text-muted mt-1">Parts: {s.parts.join(", ")}</Text> : null}
                  {s.tools?.length ? <Text className="text-[11px] text-muted">Tools: {s.tools.join(", ")}</Text> : null}
                </View>
              ))}
            </View>
          )
        )}

        {section === "drawings" && getFileContent && (
          svgFiles.length === 0 ? <Empty label="No drawings yet." /> : (
            <View className="gap-3">
              {svgFiles.map((f) => (
                <View key={f.id} className="gap-1">
                  <Text className="text-xs font-semibold text-muted" numberOfLines={1}>{f.name}</Text>
                  <SvgPreview fileId={f.id} getFileContent={getFileContent} />
                </View>
              ))}
              <Text className="text-[11px] text-muted">3D meshes and FEA render in full in the desktop Studio and the exported PDF.</Text>
            </View>
          )
        )}

        {section === "files" && (
          <View className="gap-2">
            <Text className="text-xs text-muted">
              3D meshes, patterns and FEA render in full in the desktop Studio and the exported PDF. Tap any file to save it to your device.
            </Text>
            {data.files.length === 0 ? <Empty label="No files yet." /> : data.files.map((f) => (
              <Pressable key={f.id} testID={`item-plan-file-${f.id}`} onPress={() => onOpenFile(f)}
                className="flex-row items-center justify-between rounded-lg border border-border bg-card p-3 active:opacity-60">
                <View className="flex-1 min-w-0 pr-2">
                  <Text className="text-sm text-foreground" numberOfLines={1}>{f.name}</Text>
                  <Text className="text-[11px] text-muted">{f.kind.replace(/_/g, " ")}{f.sizeBytes ? ` · ${(f.sizeBytes / 1024).toFixed(0)} KB` : ""}</Text>
                </View>
                <Text className="text-primary text-xs font-semibold">Save</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Empty({ label }: { label: string }) {
  return <Text className="text-sm text-muted text-center py-10">{label}</Text>;
}

/**
 * Renders a plan SVG (drawing/pattern) inline. Fetches the file bytes lazily and
 * hands the `data:` URI to a WebView (no base64 decode needed on-device — the
 * WebView renders the data URI directly). Falls back to a note on fetch failure.
 */
function SvgPreview({ fileId, getFileContent }: {
  fileId: string;
  getFileContent: (fileId: string) => Promise<{ contentBase64: string; mimeType: string } | null>;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFileContent(fileId)
      .then((r) => { if (cancelled) return; if (r) setUri(`data:${r.mimeType || "image/svg+xml"};base64,${r.contentBase64}`); else setFailed(true); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [fileId, getFileContent]);

  if (failed) return <Text className="text-[11px] text-muted">{"Couldn't load this drawing — open it from Files instead."}</Text>;
  return (
    <View className="rounded-lg border border-border overflow-hidden bg-white" style={{ height: 260 }}>
      {uri ? (
        <WebView
          testID={`webview-drawing-${fileId}`}
          originWhitelist={["*"]}
          source={{ uri }}
          scalesPageToFit
          style={{ flex: 1, backgroundColor: "#fff" }}
        />
      ) : (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      )}
    </View>
  );
}
