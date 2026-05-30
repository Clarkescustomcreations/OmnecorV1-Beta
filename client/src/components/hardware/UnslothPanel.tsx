import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Slider } from "../ui/progress";
import { Zap, Save, Database, Activity } from "lucide-react";
import { toast } from "sonner";

export const UnslothPanel: React.FC = () => {
  const [loraRank, setLoraRank] = useState(16);
  
  const startFineTuning = trpc.training.startFineTuning.useMutation({
    onSuccess: () => toast.success("Fine-tuning process initialized via Unsloth"),
    onError: (err) => toast.error("Training error: " + err.message)
  });

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-500" /> Unsloth LLM Builder
        </h2>
        <p className="text-sm text-muted-foreground">High-performance local LoRA fine-tuning powered by Unsloth FastLanguageModel.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Fine-Tuning Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Base Model</Label>
                <Input defaultValue="unsloth/llama-3-8b-bnb-4bit" />
              </div>
              <div className="space-y-2">
                <Label>Dataset Path (JSONL)</Label>
                <Input placeholder="/path/to/dataset.jsonl" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>LoRA Rank (R)</Label>
                <span className="text-xs font-mono">{loraRank}</span>
              </div>
              {/* Using a custom slider placeholder since we don't have the shadcn slider imported */}
              <div className="h-6 flex items-center">
                 <div className="w-full h-2 bg-muted rounded-full relative overflow-hidden">
                    <div className="h-full bg-yellow-500" style={{ width: `${(loraRank / 128) * 100}%` }} />
                 </div>
              </div>
              <p className="text-[10px] text-muted-foreground italic">Higher rank allows more complex learning but increases VRAM usage.</p>
            </div>

            <div className="flex gap-2">
               <Button className="flex-1 bg-yellow-600 hover:bg-yellow-700" onClick={() => startFineTuning.mutate({ 
                 projectId: "default", 
                 r: loraRank,
                 loraAlpha: 32,
                 maxSeqLength: 2048,
                 saveMethod: "gguf"
               })}>
                 <Activity className="w-4 h-4 mr-2" /> Start Training Pass
               </Button>
               <Button variant="outline"><Save className="w-4 h-4 mr-2" /> Save Config</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" /> VRAM Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted rounded-md text-[10px] font-mono space-y-1">
               <div className="flex justify-between"><span>Status:</span> <span className="text-green-500 uppercase">Ready</span></div>
               <div className="flex justify-between"><span>VRAM Available:</span> <span>16.0 GB</span></div>
               <div className="flex justify-between"><span>Est. Required:</span> <span>4.2 GB</span></div>
               <div className="flex justify-between"><span>Optimization:</span> <span className="text-blue-500">4-bit BNB</span></div>
            </div>
            <div className="text-xs text-muted-foreground p-2 border border-dashed rounded italic">
               Unsloth reduces memory usage by up to 60% compared to standard fine-tuning.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
