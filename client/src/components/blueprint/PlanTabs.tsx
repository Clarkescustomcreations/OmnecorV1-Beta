/**
 * Blueprint Studio — the Build Plan viewer.
 *
 * Tabbed document view of everything the planning agent produces: Overview
 * (markdown + concept renders), BOM (hand-editable), Cut List (hand-editable),
 * Drawings (inline SVG blueprints + SVG/DXF download), 3D (compiled parts +
 * FEA heatmap overlay), Patterns (true-scale PDFs), Simulation (calc/FEA
 * results with workings), Steps, and Files. All dimension display converts
 * from the stored mm to the plan's units.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc, vanillaTrpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  FileBox,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { LazyPreviewPane } from "@/components/designer/LazyPreviewPane";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { MeshJson } from "@shared/blueprint";
import type { FeaField } from "./BlueprintMeshViewer";

const BlueprintMeshViewer = lazyWithRetry(() =>
  import("./BlueprintMeshViewer").then((m) => ({ default: m.BlueprintMeshViewer })),
);

type PlanData = inferRouterOutputs<AppRouter>["blueprint"]["get"];
type BomItem = PlanData["bomItems"][number];
type CutItem = PlanData["cutItems"][number];
type PlanFile = PlanData["files"][number];

interface PlanTabsProps {
  planId: string;
  data: PlanData;
  onRefresh: () => void;
}

// ── Unit display helpers (stored truth is mm) ───────────────────────────────

function fmtLen(mm: number | null | undefined, units: string): string {
  if (mm === null || mm === undefined) return "—";
  if (units === "metric") return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  if (inches < 12) return `${inches.toFixed(2)}"`;
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  return rem < 0.05 ? `${ft}'` : `${ft}' ${rem.toFixed(1)}"`;
}

const fmtAngle = (d: number | null | undefined) => (d === null || d === undefined || d === 0 ? "□" : `${d.toFixed(1)}°`);

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

export function PlanTabs({ planId, data, onRefresh }: PlanTabsProps) {
  const { plan } = data;
  const utils = trpc.useUtils();

  const downloadFile = useCallback(
    async (file: Pick<PlanFile, "id" | "name">, openInTab = false) => {
      try {
        const res = await vanillaTrpc.blueprint.getFile.query({ planId, fileId: file.id });
        const blob = base64ToBlob(res.contentBase64, res.mimeType);
        const url = URL.createObjectURL(blob);
        if (openInTab) {
          window.open(url, "_blank");
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.download = res.name;
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        toast.error(`Download failed: ${(err as Error).message}`);
      }
    },
    [planId],
  );

  const bomTotal = useMemo(
    () => data.bomItems.reduce((s, i) => s + (i.unitCost ?? 0) * i.quantity, 0),
    [data.bomItems],
  );

  return (
    <Tabs defaultValue="overview" className="flex h-full flex-col">
      <TabsList className="flex w-full flex-wrap justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="bom">BOM {data.bomItems.length > 0 && <Badge variant="secondary" className="ml-1">{data.bomItems.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="cutlist">Cut List {data.cutItems.length > 0 && <Badge variant="secondary" className="ml-1">{data.cutItems.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="drawings">Drawings</TabsTrigger>
        <TabsTrigger value="3d">3D</TabsTrigger>
        <TabsTrigger value="patterns">Patterns</TabsTrigger>
        <TabsTrigger value="simulation">Simulation {data.simResults.length > 0 && <Badge variant="secondary" className="ml-1">{data.simResults.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="steps">Steps</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        <TabsContent value="overview" className="m-0">
          <OverviewTab planId={planId} data={data} downloadFile={downloadFile} />
        </TabsContent>
        <TabsContent value="bom" className="m-0">
          <BomTab planId={planId} items={data.bomItems} total={bomTotal} onChanged={() => { void utils.blueprint.get.invalidate({ planId }); onRefresh(); }} />
        </TabsContent>
        <TabsContent value="cutlist" className="m-0">
          <CutListTab planId={planId} items={data.cutItems} units={plan.units} onChanged={() => { void utils.blueprint.get.invalidate({ planId }); onRefresh(); }} />
        </TabsContent>
        <TabsContent value="drawings" className="m-0">
          <DrawingsTab planId={planId} files={data.files} downloadFile={downloadFile} />
        </TabsContent>
        <TabsContent value="3d" className="m-0 h-[540px]">
          <ThreeDTab planId={planId} files={data.files} onChanged={() => { void utils.blueprint.get.invalidate({ planId }); onRefresh(); }} />
        </TabsContent>
        <TabsContent value="patterns" className="m-0">
          <PatternsTab files={data.files} downloadFile={downloadFile} />
        </TabsContent>
        <TabsContent value="simulation" className="m-0">
          <SimulationTab data={data} />
        </TabsContent>
        <TabsContent value="steps" className="m-0">
          <StepsTab data={data} />
        </TabsContent>
        <TabsContent value="files" className="m-0">
          <FilesTab files={data.files} downloadFile={downloadFile} onRefresh={onRefresh} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ planId, data, downloadFile }: { planId: string; data: PlanData; downloadFile: (f: Pick<PlanFile, "id" | "name">, openInTab?: boolean) => void }) {
  const { plan } = data;
  const conceptFiles = useMemo(() => data.files.filter((f) => f.kind === "concept_image").slice(0, 6), [data.files]);
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const file of conceptFiles) {
        if (images[file.id]) continue;
        try {
          const res = await vanillaTrpc.blueprint.getFile.query({ planId, fileId: file.id });
          if (cancelled) return;
          setImages((prev) => ({ ...prev, [file.id]: `data:${res.mimeType};base64,${res.contentBase64}` }));
        } catch {
          /* image missing on disk — the files tab still lists the row */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptFiles.map((f) => f.id).join(",")]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{plan.category.replace("_", " ")}</Badge>
        <Badge variant="outline">{plan.units}</Badge>
        <Badge variant="outline">CAD: {plan.cadEngine.toUpperCase()}</Badge>
        <Badge variant={plan.status === "ready" || plan.status === "complete" ? "default" : "secondary"}>{plan.status}</Badge>
      </div>
      {plan.brief && (
        <Card className="p-3 text-sm text-muted-foreground italic">Brief: {plan.brief}</Card>
      )}
      {conceptFiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {conceptFiles.map((f) => (
            <button key={f.id} type="button" className="group relative overflow-hidden rounded-md border border-border/60" onClick={() => downloadFile(f, true)}>
              {images[f.id] ? (
                <img src={images[f.id]} alt={f.name} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted/40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
            </button>
          ))}
        </div>
      )}
      {plan.overview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Streamdown>{plan.overview}</Streamdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No overview yet — describe your project in the conversation and the agent will draft the plan here.</p>
      )}
      {plan.safetyNotes && (
        <Card className="border-accent-danger/40 p-3">
          <div className="mb-1 text-sm font-semibold text-accent-danger">Safety notes</div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Streamdown>{plan.safetyNotes}</Streamdown>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOM (hand-editable)
// ─────────────────────────────────────────────────────────────────────────────

interface BomDraft {
  id?: string;
  name: string;
  kind: "material" | "hardware" | "tool" | "consumable";
  spec: string;
  quantity: number;
  unit: string;
  unitCost: number | null;
  supplier?: string;
  notes?: string;
}

function BomTab({ planId, items, total, onChanged }: { planId: string; items: BomItem[]; total: number; onChanged: () => void }) {
  const [draft, setDraft] = useState<BomDraft | null>(null);
  const upsert = trpc.blueprint.upsertBomItem.useMutation({
    onSuccess: () => { setDraft(null); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.blueprint.deleteBomItem.useMutation({
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });

  const exportList = useCallback(async () => {
    try {
      const data = await vanillaTrpc.blueprint.exportBom.query({ planId });
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "purchase-list.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.itemCount} item(s) — known-price total $${data.totalUsd.toFixed(2)}`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }, [planId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Estimated material cost: <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
          <span className="ml-1 text-xs">(planning estimate)</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={items.length === 0} onClick={exportList}>
            <Download className="mr-1 h-4 w-4" /> Export list
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({ name: "", kind: "material", spec: "", quantity: 1, unit: "pcs", unitCost: null })}>
            <Plus className="mr-1 h-4 w-4" /> Add item
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No materials yet — the agent fills this as the design firms up.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Line</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.name}</div>
                  {item.kind !== "material" && <Badge variant="secondary" className="mt-0.5 text-[10px]">{item.kind}</Badge>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.spec || "—"}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-right">{item.unitCost != null ? `$${item.unitCost.toFixed(2)}` : "—"}</TableCell>
                <TableCell className="text-right">{item.unitCost != null ? `$${(item.unitCost * item.quantity).toFixed(2)}` : "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDraft({ id: item.id, name: item.name, kind: item.kind, spec: item.spec, quantity: item.quantity, unit: item.unit, unitCost: item.unitCost, supplier: item.supplier ?? undefined, notes: item.notes ?? undefined })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ planId, id: item.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit BOM item" : "Add BOM item"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-sm">Name
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="col-span-2 text-sm">Spec
                <Input value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} placeholder='e.g. 2×4 SPF, 8 ft' />
              </label>
              <label className="text-sm">Quantity
                <Input type="number" min={0} step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })} />
              </label>
              <label className="text-sm">Unit
                <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              </label>
              <label className="text-sm">Unit cost (USD)
                <Input type="number" min={0} step="any" value={draft.unitCost ?? ""} onChange={(e) => setDraft({ ...draft, unitCost: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="text-sm">Kind
                <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as BomDraft["kind"] })}>
                  <option value="material">material</option>
                  <option value="hardware">hardware</option>
                  <option value="tool">tool</option>
                  <option value="consumable">consumable</option>
                </select>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={!draft?.name || upsert.isPending}
              onClick={() => draft && upsert.mutate({ planId, id: draft.id, name: draft.name, kind: draft.kind, spec: draft.spec, quantity: draft.quantity, unit: draft.unit, unitCost: draft.unitCost, supplier: draft.supplier, notes: draft.notes })}
            >
              {upsert.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cut list (hand-editable)
// ─────────────────────────────────────────────────────────────────────────────

interface CutDraft {
  id?: string;
  partLabel: string;
  stockName: string;
  quantity: number;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  miter1Deg: number | null;
  miter2Deg: number | null;
  notes?: string;
}

function CutListTab({ planId, items, units, onChanged }: { planId: string; items: CutItem[]; units: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<CutDraft | null>(null);
  const upsert = trpc.blueprint.upsertCutItem.useMutation({
    onSuccess: () => { setDraft(null); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.blueprint.deleteCutItem.useMutation({ onSuccess: onChanged, onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">□ = square cut · angles are miter/bevel from square · lengths shown in {units} (stored metric)</p>
        <Button size="sm" variant="outline" onClick={() => setDraft({ partLabel: "", stockName: "", quantity: 1, lengthMm: null, widthMm: null, thicknessMm: null, miter1Deg: null, miter2Deg: null })}>
          <Plus className="mr-1 h-4 w-4" /> Add part
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cut list yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead>From stock</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Length</TableHead>
              <TableHead className="text-right">W × T</TableHead>
              <TableHead>End 1</TableHead>
              <TableHead>End 2</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.partLabel}</div>
                  {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.stockName || "—"}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right font-mono text-sm">{fmtLen(item.lengthMm, units)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {item.widthMm != null || item.thicknessMm != null ? `${fmtLen(item.widthMm, units)} × ${fmtLen(item.thicknessMm, units)}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">{fmtAngle(item.miter1Deg)}{item.bevel1Deg ? ` / ${fmtAngle(item.bevel1Deg)}` : ""}</TableCell>
                <TableCell className="font-mono text-sm">{fmtAngle(item.miter2Deg)}{item.bevel2Deg ? ` / ${fmtAngle(item.bevel2Deg)}` : ""}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDraft({ id: item.id, partLabel: item.partLabel, stockName: item.stockName, quantity: item.quantity, lengthMm: item.lengthMm, widthMm: item.widthMm, thicknessMm: item.thicknessMm, miter1Deg: item.miter1Deg, miter2Deg: item.miter2Deg, notes: item.notes ?? undefined })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate({ planId, id: item.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit part" : "Add part"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-sm">Part label
                <Input value={draft.partLabel} onChange={(e) => setDraft({ ...draft, partLabel: e.target.value })} />
              </label>
              <label className="col-span-2 text-sm">From stock
                <Input value={draft.stockName} onChange={(e) => setDraft({ ...draft, stockName: e.target.value })} placeholder='e.g. 2×4 SPF 96"' />
              </label>
              <label className="text-sm">Quantity
                <Input type="number" min={1} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Math.max(1, Math.round(Number(e.target.value))) })} />
              </label>
              <label className="text-sm">Length (mm)
                <Input type="number" min={0} step="any" value={draft.lengthMm ?? ""} onChange={(e) => setDraft({ ...draft, lengthMm: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="text-sm">Miter end 1 (°)
                <Input type="number" min={-90} max={90} step="any" value={draft.miter1Deg ?? ""} onChange={(e) => setDraft({ ...draft, miter1Deg: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="text-sm">Miter end 2 (°)
                <Input type="number" min={-90} max={90} step="any" value={draft.miter2Deg ?? ""} onChange={(e) => setDraft({ ...draft, miter2Deg: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={!draft?.partLabel || upsert.isPending}
              onClick={() => draft && upsert.mutate({ planId, id: draft.id, partLabel: draft.partLabel, stockName: draft.stockName, quantity: draft.quantity, lengthMm: draft.lengthMm, widthMm: draft.widthMm, thicknessMm: draft.thicknessMm, miter1Deg: draft.miter1Deg, miter2Deg: draft.miter2Deg, notes: draft.notes })}
            >
              {upsert.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawings
// ─────────────────────────────────────────────────────────────────────────────

function DrawingsTab({ planId, files, downloadFile }: { planId: string; files: PlanFile[]; downloadFile: (f: Pick<PlanFile, "id" | "name">) => void }) {
  const drawings = useMemo(() => files.filter((f) => f.kind === "drawing_svg" && f.isLatest !== false), [files]);
  const dxfs = useMemo(() => files.filter((f) => f.kind === "drawing_dxf" && f.isLatest !== false), [files]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeId = selectedId ?? drawings[0]?.id ?? null;

  useEffect(() => {
    if (!activeId) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    vanillaTrpc.blueprint.getFile
      .query({ planId, fileId: activeId })
      .then((res) => {
        if (!cancelled) setSvg(atob(res.contentBase64));
      })
      .catch((err) => !cancelled && toast.error(`Failed to load drawing: ${(err as Error).message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, planId]);

  if (drawings.length === 0) {
    return <p className="text-sm text-muted-foreground">No blueprint drawings yet — ask the agent to compile the design (compile_cad produces dimensioned three-view drawings automatically).</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {drawings.map((d) => (
          <Button key={d.id} size="sm" variant={d.id === activeId ? "default" : "outline"} onClick={() => setSelectedId(d.id)}>
            {d.name.replace(/\.drawing\.svg$/, "")}
          </Button>
        ))}
      </div>
      <Card className="overflow-auto bg-white p-2">
        {loading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : svg ? (
          // Server-generated SVG (trusted, same-origin artifact — not user HTML).
          <div className="min-w-[700px]" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : null}
      </Card>
      <div className="flex flex-wrap gap-2">
        {activeId && (
          <Button size="sm" variant="outline" onClick={() => { const f = drawings.find((d) => d.id === activeId); if (f) downloadFile(f); }}>
            <Download className="mr-1 h-4 w-4" /> SVG
          </Button>
        )}
        {dxfs.map((d) => (
          <Button key={d.id} size="sm" variant="outline" onClick={() => downloadFile(d)}>
            <Download className="mr-1 h-4 w-4" /> {d.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D
// ─────────────────────────────────────────────────────────────────────────────

function ThreeDTab({ planId, files, onChanged }: { planId: string; files: PlanFile[]; onChanged: () => void }) {
  // Latest mesh per part name (files come newest-first from the server).
  const meshFiles = useMemo(() => {
    const seen = new Set<string>();
    return files.filter((f) => {
      if (f.kind !== "mesh_json" || f.isLatest === false || seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
  }, [files]);
  const feaFiles = useMemo(() => files.filter((f) => f.kind === "fea_result"), [files]);

  const [parts, setParts] = useState<{ name: string; mesh: MeshJson }[]>([]);
  const [feaField, setFeaField] = useState<FeaField | null>(null);
  const [feaId, setFeaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const loaded: { name: string; mesh: MeshJson }[] = [];
      for (const f of meshFiles.slice(0, 8)) {
        try {
          const res = await vanillaTrpc.blueprint.getFile.query({ planId, fileId: f.id });
          loaded.push({ name: f.name.replace(/\.mesh\.json$/, ""), mesh: JSON.parse(atob(res.contentBase64)) as MeshJson });
        } catch {
          /* skip missing */
        }
        if (cancelled) return;
      }
      if (!cancelled) setParts(loaded);
    })().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, meshFiles.map((f) => f.id).join(",")]);

  const loadFea = useCallback(
    async (fileId: string | null) => {
      setFeaId(fileId);
      if (!fileId) {
        setFeaField(null);
        return;
      }
      try {
        const res = await vanillaTrpc.blueprint.getFile.query({ planId, fileId });
        setFeaField(JSON.parse(atob(res.contentBase64)) as FeaField);
      } catch (err) {
        toast.error(`Failed to load FEA field: ${(err as Error).message}`);
        setFeaId(null);
      }
    },
    [planId],
  );

  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const importGeo = trpc.blueprint.importGeometry.useMutation({
    onSuccess: (res) => { toast.success(`Imported "${res.part.name}" (${res.format.toUpperCase()})`); onChanged(); },
    onError: (e) => toast.error(`Import failed: ${e.message}`),
    onSettled: () => setImporting(false),
  });
  const onImportFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      const format = lower.endsWith(".dxf") ? "dxf" : lower.endsWith(".stl") ? "stl" : null;
      if (!format) { toast.error("Import an .stl or .dxf file."); return; }
      setImporting(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      importGeo.mutate({ planId, name: file.name, format, contentBase64: btoa(binary) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planId],
  );

  const importBar = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={importRef}
        type="file"
        accept=".stl,.dxf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.currentTarget.value = ""; }}
      />
      <Button size="sm" variant="outline" disabled={importing} onClick={() => importRef.current?.click()}>
        {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Import STL/DXF
      </Button>
      <span className="text-xs text-muted-foreground">Bring in an existing STL (3D + FEA) or a DXF outline.</span>
    </div>
  );

  if (meshFiles.length === 0) {
    return (
      <div className="space-y-3">
        {importBar}
        <p className="text-sm text-muted-foreground">No compiled geometry yet — ask the agent to model the design (compile_cad), or import an STL/DXF above.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {importBar}
      {feaFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Stress overlay:</span>
          <Button size="sm" variant={feaId === null ? "default" : "outline"} onClick={() => void loadFea(null)}>None</Button>
          {feaFiles.map((f) => (
            <Button key={f.id} size="sm" variant={feaId === f.id ? "default" : "outline"} onClick={() => void loadFea(f.id)}>
              {f.name.replace(/\.fea\.json$/, "")}
            </Button>
          ))}
        </div>
      )}
      <Card className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <LazyPreviewPane>
            <BlueprintMeshViewer parts={parts} feaField={feaField} />
          </LazyPreviewPane>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns / Simulation / Steps / Files
// ─────────────────────────────────────────────────────────────────────────────

function PatternsTab({ files, downloadFile }: { files: PlanFile[]; downloadFile: (f: Pick<PlanFile, "id" | "name">, openInTab?: boolean) => void }) {
  const patterns = files.filter((f) => f.kind === "pattern_pdf");
  if (patterns.length === 0) {
    return <p className="text-sm text-muted-foreground">No patterns yet — for fabric/foam parts, ask the agent to generate true-scale printable patterns.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Print at 100% / actual size and verify the calibration square before cutting.</p>
      {patterns.map((f) => (
        <Card key={f.id} className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{f.name}</div>
              <div className="text-xs text-muted-foreground">{((f.sizeBytes ?? 0) / 1024).toFixed(0)} KB · {(f.meta as { pieceCount?: number } | null)?.pieceCount ?? "?"} pieces</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadFile(f, true)}>Open</Button>
            <Button size="sm" variant="outline" onClick={() => downloadFile(f)}><Download className="mr-1 h-4 w-4" /> PDF</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SimulationTab({ data }: { data: PlanData }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (data.simResults.length === 0) {
    return <p className="text-sm text-muted-foreground">No structural verification yet — the agent records every engineering calculation and FEA run here, with the formulas used.</p>;
  }
  return (
    <div className="space-y-2">
      {data.simResults.map((sim) => {
        const res = (sim.results ?? {}) as { safetyFactor?: number; pass?: boolean; workings?: string[]; maxVonMisesMPa?: number; maxDisplacementMm?: number; outputs?: Record<string, unknown>; warnings?: { severity: string; message: string }[] };
        const isOpen = expanded.has(sim.id);
        return (
          <Card key={sim.id} className="p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(sim.id)) next.delete(sim.id); else next.add(sim.id); return next; })}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">{sim.kind.toUpperCase()}</Badge>
                <span className="text-sm font-medium">{sim.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {typeof res.safetyFactor === "number" && (
                  <span className="font-mono text-sm">SF {res.safetyFactor.toFixed(2)}</span>
                )}
                {sim.status === "running" && (
                  <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> RUNNING</Badge>
                )}
                {res.pass === true && <Badge className="bg-accent-success text-foreground hover:bg-accent-success">PASS</Badge>}
                {res.pass === false && <Badge variant="destructive">REVIEW</Badge>}
                {sim.status === "failed" && <Badge variant="destructive">FAILED</Badge>}
              </div>
            </button>
            {isOpen && (
              <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {res.maxVonMisesMPa !== undefined && (
                  <div className="text-xs">Max von Mises: <span className="font-mono">{res.maxVonMisesMPa.toFixed(2)} MPa</span> · Max displacement: <span className="font-mono">{res.maxDisplacementMm?.toFixed(3)} mm</span></div>
                )}
                {(res.workings ?? []).map((line, i) => (
                  <div key={i} className="font-mono text-xs text-muted-foreground">{line}</div>
                ))}
                {(res.warnings ?? []).map((w, i) => (
                  <div key={`w${i}`} className={`text-xs ${w.severity === "critical" ? "text-destructive" : w.severity === "warning" ? "text-accent-danger" : "text-muted-foreground"}`}>
                    {w.severity === "critical" ? "⚠ " : ""}{w.message}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function StepsTab({ data }: { data: PlanData }) {
  const steps = data.plan.assemblySteps ?? [];
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No assembly steps yet — they land here once the design is settled.</p>;
  }
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{step.title}</div>
            <div className="text-sm text-muted-foreground">{step.detail}</div>
            {(step.parts?.length ?? 0) > 0 && <div className="mt-0.5 text-xs text-muted-foreground">Parts: {step.parts!.join(", ")}</div>}
            {(step.tools?.length ?? 0) > 0 && <div className="text-xs text-muted-foreground">Tools: {step.tools!.join(", ")}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function FilesTab({ files, downloadFile, onRefresh }: { files: PlanFile[]; downloadFile: (f: Pick<PlanFile, "id" | "name">) => void; onRefresh: () => void }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No generated files yet.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="mr-1 h-4 w-4" /> Refresh</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-center">Ver</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((f) => {
            const superseded = f.isLatest === false;
            return (
            <TableRow key={f.id} className={superseded ? "opacity-60" : undefined}>
              <TableCell className="flex items-center gap-2 text-sm">
                <FileBox className="h-4 w-4 text-muted-foreground" /> {f.name}
                {superseded && <span className="text-[10px] text-muted-foreground">(superseded)</span>}
              </TableCell>
              <TableCell><Badge variant="secondary" className="text-[10px]">{f.kind}</Badge></TableCell>
              <TableCell className="text-center text-xs text-muted-foreground">{(f.version ?? 1) > 1 || superseded ? `v${f.version ?? 1}` : "—"}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{((f.sizeBytes ?? 0) / 1024).toFixed(0)} KB</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadFile(f)}><Download className="h-3.5 w-3.5" /></Button>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
