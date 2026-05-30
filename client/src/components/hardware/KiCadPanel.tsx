import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../ui/table";
import { Badge } from "../ui/badge";
import { CircuitBoard, AlertTriangle, FileSpreadsheet, Layers, Share2 } from "lucide-react";
import { toast } from "sonner";

export const KiCadPanel: React.FC = () => {
  const [activeProject, setActiveProject] = useState<string | null>(null);

  const statusQuery = trpc.kicad.status.useQuery();
  const drcMutation = trpc.kicad.runDRC.useMutation();
  const exportMutation = trpc.kicad.exportSchematic.useMutation();
  const bomMutation = trpc.kicad.exportBOM.useMutation();

  const handleOpenProject = () => {
    setActiveProject("project.kicad_pro");
    toast.success("Project activated: project.kicad_pro");
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg border border-dashed">
        <div className="flex items-center gap-3">
          <CircuitBoard className="w-8 h-8 text-blue-500" />
          <div>
            <h3 className="font-bold">KiCad EDA Integration</h3>
            <p className="text-xs text-muted-foreground">
              {activeProject ? `Active: ${activeProject}` : "No project loaded. Select a .kicad_pro file."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
            <Badge variant={statusQuery.data?.installed ? "default" : "destructive"}>
                {statusQuery.data?.installed ? "KiCad CLI Active" : "KiCad Missing"}
            </Badge>
            <Button onClick={handleOpenProject} disabled={!statusQuery.data?.installed}>
                Open Project
            </Button>
        </div>
      </div>

      <Tabs defaultValue="drc" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="drc"><AlertTriangle className="w-3 h-3 mr-2" /> DRC/ERC</TabsTrigger>
          <TabsTrigger value="bom"><FileSpreadsheet className="w-3 h-3 mr-2" /> BOM</TabsTrigger>
          <TabsTrigger value="export"><Share2 className="w-3 h-3 mr-2" /> Export</TabsTrigger>
        </TabsList>

        <Card className="mt-4">
          <TabsContent value="drc" className="p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-semibold">Design Rule Check Results</h4>
              <Button size="sm" onClick={() => drcMutation.mutate({ pcbPath: "board.kicad_pcb" })} disabled={drcMutation.isPending}>
                {drcMutation.isPending ? "Validating..." : "Run Validation"}
              </Button>
            </div>
            {drcMutation.data ? (
              <div className="space-y-2">
                {(drcMutation.data as any).violations?.map((v: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-md text-xs">
                    <Badge variant={v.severity === "Error" ? "destructive" : "outline"}>{v.severity}</Badge>
                    <div>
                      <p className="font-bold">{v.rule}</p>
                      <p className="opacity-70">{v.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground italic">Run DRC to see violations</div>
            )}
          </TabsContent>

          <TabsContent value="bom" className="p-4 space-y-4">
             <div className="flex justify-between items-center">
              <h4 className="text-sm font-semibold">Bill of Materials</h4>
              <Button size="sm" variant="outline" onClick={() => bomMutation.mutate({ inputFile: "project.kicad_sch", outputFile: "bom.csv" })}>
                Generate BOM
              </Button>
            </div>
            {bomMutation.isSuccess ? (
                <div className="p-8 text-center bg-green-500/5 border border-green-500/20 rounded-lg">
                    <p className="text-sm font-medium text-green-600">BOM generated successfully!</p>
                    <Button variant="link" className="text-xs">Download bom.csv</Button>
                </div>
            ) : (
                <div className="py-12 text-center text-muted-foreground italic">No BOM generated yet</div>
            )}
          </TabsContent>

          <TabsContent value="export" className="p-6 flex flex-col items-center gap-4">
            <div className="w-full max-w-2xl aspect-video bg-zinc-100 dark:bg-zinc-900 rounded-lg border flex items-center justify-center relative overflow-hidden">
               <CircuitBoard className="w-12 h-12 text-muted-foreground opacity-20" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportMutation.mutate({ inputFile: "project.kicad_sch", outputDir: "exports", format: "svg" })}>
                Generate SVG Preview
              </Button>
            </div>
          </TabsContent>
        </Card>
      </Tabs>
    </div>
  );
};
