import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Box, 
  Cpu, 
  Play, 
  Download, 
  CheckCircle2, 
  Activity, 
  ShoppingCart, 
  AlertTriangle,
  Loader2,
  Trash2,
  Settings,
  ShieldCheck,
  Truck
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

interface ManufacturingPanelProps {
  activeFile: string | null;
  mode: "3d" | "pcb";
}

interface PCBQuote {
  totalCost: number;
  currency: string;
  estimatedDays: number;
  layers: number;
  lengthMm: number;
  widthMm: number;
  qty: number;
}

export function ManufacturingPanel({ activeFile, mode }: ManufacturingPanelProps) {
  const [activeTab, setActiveTab] = useState(mode);
  const [quote, setQuote] = useState<PCBQuote | null>(null);
  const [qty, setQty] = useState(5);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { jobLifecycle } = useOmnecorSocket({ jobId: activeJobId ?? undefined });

  // React to job completion — show toast and clear the tracked job
  useEffect(() => {
    if (jobLifecycle === "completed" && activeJobId) {
      toast.success("Job completed — preview updated.");
      setActiveJobId(null);
    } else if (jobLifecycle === "failed" && activeJobId) {
      toast.error("Job failed. Check the Jobs panel for details.");
      setActiveJobId(null);
    }
  }, [jobLifecycle, activeJobId]);
  const [address, setShippingAddress] = useState({
    name: "Omnecor Lab",
    address: "123 Silicon Alley",
    city: "New York",
    country: "USA",
    zipCode: "10001"
  });

  // Queries
  const { data: blenderStatus } = trpc.blender.status.useQuery();
  const { data: kicadStatus } = trpc.kicad.status.useQuery();

  // Mutations
  const renderMutation = trpc.blender.render.useMutation({
    onSuccess: (data) => { toast.success(`Render job started: ${data.jobId}`); setActiveJobId(data.jobId); },
    onError: (err) => toast.error("Render failed: " + err.message),
  });

  const drcMutation = trpc.kicad.runDRC.useMutation({
    onSuccess: (data) => {
      if (data.violations.length === 0) {
        toast.success("DRC Passed! No violations found.");
      } else {
        toast.warning(`DRC Failed: ${data.violations} violations found.`);
      }
    },
    onError: (err) => toast.error("DRC failed: " + err.message),
  });

  const quoteMutation = trpc.kicad.getQuote.useMutation({
    onSuccess: (data) => {
      setQuote(data as unknown as PCBQuote);
      toast.success("Manufacturing quote received");
    },
    onError: (err) => toast.error("Quote request failed: " + err.message),
  });

  const orderMutation = trpc.kicad.placeOrder.useMutation({
    onSuccess: (data) => toast.success(`PCB order placed (#${data.orderId}). Check your wallet for transaction details.`),
    onError: (e) => toast.error(`Order failed: ${e.message}`)
  });

  // Build + download the Gerber/drill fabrication package (.zip).
  const exportFabMutation = trpc.kicad.exportForManufacturing.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Fabrication package ready — ${data.fileCount} files`);
    },
    onError: (e) => toast.error("Fabrication export failed: " + e.message),
  });

  const stlExportMutation = trpc.blender.export.useMutation({
    onSuccess: (data) => { toast.success("STL export job started"); setActiveJobId(data.jobId); },
    onError: (e) => toast.error("STL export failed: " + e.message),
  });
  const glbExportMutation = trpc.blender.export.useMutation({
    onSuccess: (data) => { toast.success("GLB export job started"); setActiveJobId(data.jobId); },
    onError: (e) => toast.error("GLB export failed: " + e.message),
  });

  return (
    <div className="flex flex-col h-full bg-card border-l border-border w-80">
      <div className="p-4 border-b border-border bg-background flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider">Manufacturing Engine</span>
        </div>
        <Badge variant="outline" className="text-[10px] h-5 border-primary/20 text-primary">Phase 3</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "3d" | "pcb")} className="min-h-0 flex-1 overflow-hidden flex flex-col">
        <div className="p-2 bg-background/50">
          <TabsList className="grid w-full grid-cols-2 h-8 bg-card">
            <TabsTrigger value="3d" className="text-[10px] gap-1.5"><Box className="w-3 h-3" /> 3D Render</TabsTrigger>
            <TabsTrigger value="pcb" className="text-[10px] gap-1.5"><Cpu className="w-3 h-3" /> PCB Fab</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 space-y-6 custom-scrollbar">
          {/* 3D Tab */}
          <TabsContent value="3d" className="m-0 space-y-6">
            <Card className="bg-background border-border shadow-none">
              <CardHeader className="p-4">
                <CardTitle className="text-sm">Blender Headless</CardTitle>
                <CardDescription className="text-[10px]">Remote rendering & export engine status</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Engine</span>
                  <div className="flex items-center gap-1.5">
                    <div className={cn("w-1.5 h-1.5 rounded-full", blenderStatus?.isInstalled ? "bg-accent-success" : "bg-destructive")} />
                    <span className="text-[10px] font-mono">{blenderStatus?.isInstalled ? "Ready" : "Offline"}</span>
                  </div>
                </div>

                <HowToTooltip title="Render Image" description="Start Blender rendering engine on current scene" side="top">
                  <Button 
                    className="w-full gap-2 h-9 bg-primary/10 text-accent-foreground hover:bg-primary/90"
                    disabled={!blenderStatus?.isInstalled || renderMutation.isPending}
                    onClick={() => renderMutation.mutate({ label: "High Fidelity UI Mockup" })}
                  >
                    {renderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Start Remote Render
                  </Button>
                </HowToTooltip>
                
                <div className="grid grid-cols-2 gap-2">
                  <HowToTooltip title="Export STL" description="Generate STL file for 3D printing" side="bottom">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-8 gap-1.5 border-border bg-card hover:bg-card"
                      disabled={!blenderStatus?.isInstalled || stlExportMutation.isPending}
                      onClick={() => stlExportMutation.mutate({ blendFile: "scene.blend", outputPath: "export.stl" })}
                    >
                      {stlExportMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} STL (Print)
                    </Button>
                  </HowToTooltip>
                  <HowToTooltip title="Export GLB" description="Generate GLB file for web preview" side="bottom">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-8 gap-1.5 border-border bg-card hover:bg-card"
                      disabled={!blenderStatus?.isInstalled || glbExportMutation.isPending}
                      onClick={() => glbExportMutation.mutate({ blendFile: "scene.blend", outputPath: "export.glb" })}
                    >
                      {glbExportMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} GLB (Web)
                    </Button>
                  </HowToTooltip>
                </div>
              </CardContent>
            </Card>

            <div className="p-4 rounded-xl border border-accent-warning/10 bg-accent-warning/5 space-y-2">
              <div className="flex items-center gap-2 text-accent-warning">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase">Manufacturing Note</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Ensure all normals are manifold and geometry is closed before exporting for 3D printing.
              </p>
            </div>
          </TabsContent>

          {/* PCB Tab */}
          <TabsContent value="pcb" className="m-0 space-y-6">
            <Card className="bg-background border-border shadow-none">
              <CardHeader className="p-4">
                <CardTitle className="text-sm">KiCad CLI Toolchain</CardTitle>
                <CardDescription className="text-[10px]">DRC, ERC, and Gerber generation</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">KiCad Suite</span>
                  <div className="flex items-center gap-1.5">
                    <div className={cn("w-1.5 h-1.5 rounded-full", kicadStatus?.isInstalled ? "bg-accent-success" : "bg-destructive")} />
                    <span className="text-[10px] font-mono">{kicadStatus?.isInstalled ? "Ready" : "Offline"}</span>
                  </div>
                </div>

                <HowToTooltip title="Run DRC" description="Validate PCB against design rules" side="top">
                  <Button 
                    variant="outline" 
                    className="w-full gap-2 h-9 border-border bg-card hover:bg-card"
                    disabled={!kicadStatus?.isInstalled || drcMutation.isPending}
                    onClick={() => drcMutation.mutate({ pcbPath: activeFile || "main.kicad_pcb" })}
                  >
                    {drcMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    Run Design Rules Check
                  </Button>
                </HowToTooltip>

                <HowToTooltip title="Export Manufacturing" description="Generate files needed for fabrication" side="top">
                  <Button
                    variant="outline"
                    className="w-full gap-2 h-9 border-border bg-card hover:bg-card"
                    disabled={!kicadStatus?.isInstalled || exportFabMutation.isPending}
                    onClick={() => exportFabMutation.mutate({ pcbPath: activeFile || "main.kicad_pcb" })}
                  >
                    {exportFabMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Download Fabrication Files (.zip)
                  </Button>
                </HowToTooltip>
              </CardContent>
            </Card>

            <Card className="bg-background border-border shadow-none">
              <CardHeader className="p-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-primary" /> 
                  Checkout & Fab
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                {!quote ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="pcb-qty" className="text-[10px] text-muted-foreground uppercase font-bold">Quantity</Label>
                      <Input
                        id="pcb-qty"
                        type="number"
                        min={5}
                        max={10000}
                        value={qty}
                        onChange={(e) => setQty(Math.max(5, Math.min(10000, Number(e.target.value) || 5)))}
                        className="h-8 w-24 text-[10px] bg-card border-border"
                      />
                    </div>
                    <HowToTooltip title="Refresh Estimate" description="Update manufacturing cost estimate based on current specs" side="top">
                      <Button
                        className="w-full gap-2 h-10 bg-primary hover:bg-primary text-white border-none"
                        onClick={() => quoteMutation.mutate({ pcbPath: activeFile || "main.kicad_pcb", qty })}
                        disabled={quoteMutation.isPending}
                      >
                        {quoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                        Get Manufacturing Quote
                      </Button>
                    </HowToTooltip>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold uppercase text-primary">Total ({quote.qty} pcs)</span>
                        <span className="text-lg font-bold">{quote.currency === "USD" ? "$" : ""}{quote.totalCost} {quote.currency !== "USD" ? quote.currency : ""}</span>
                      </div>
                      <p className="text-[10px] text-primary/70">
                        {quote.lengthMm}×{quote.widthMm}mm · {quote.layers}-layer · Est. lead time: {quote.estimatedDays} days
                      </p>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border">
                       <p className="text-[10px] font-bold text-muted-foreground uppercase">Shipping To:</p>
                       <div className="space-y-2">
                         <Input 
                            className="h-8 text-[10px] bg-card border-border" 
                            value={address.name} 
                            onChange={(e) => setShippingAddress({...address, name: e.target.value})}
                         />
                         <Input 
                            className="h-8 text-[10px] bg-card border-border" 
                            value={address.address} 
                            onChange={(e) => setShippingAddress({...address, address: e.target.value})}
                         />
                       </div>
                    </div>

                    <HowToTooltip title="Order Prototype" description="Submit design to partner manufacturer for fabrication" side="top">
                      <Button 
                        className="w-full h-11 gap-2 bg-accent-success hover:bg-accent-success text-white border-none font-bold"
                        onClick={() => orderMutation.mutate({ pcbPath: activeFile || "main.kicad_pcb", qty, shippingAddress: address })}
                        disabled={orderMutation.isPending}
                      >
                        {orderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                        Pay & Place Order
                      </Button>
                    </HowToTooltip>
                    <HowToTooltip title="Reject Quote" description="Decline this manufacturing quote and return to settings" side="top">
                      <Button variant="ghost" className="w-full h-8 text-[10px] text-muted-foreground" onClick={() => setQuote(null)}>
                        Cancel Quote
                      </Button>
                    </HowToTooltip>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </div>

        <div className="p-4 border-t border-border bg-background/50">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3">
             <span className="uppercase font-bold tracking-tighter">Manufacturing Queue</span>
             <span>0 Jobs</span>
          </div>
          <div className="p-3 rounded-lg border border-border bg-card text-center">
            <p className="text-[10px] italic opacity-50">No active fab jobs.</p>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
