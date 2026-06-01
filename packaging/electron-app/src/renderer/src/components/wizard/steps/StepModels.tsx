import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export const StepModels: React.FC<{ step: string; sysInfo: any }> = ({ step, sysInfo }) => {
  const isOMSH = step === 'omsh';
  const isLegacy = sysInfo?.isLegacy;

  const getRecommendedModels = () => {
    if (isLegacy) {
      return ['Llama 3.2 1B (4-bit)', 'Phi-3 Mini (3.8B)', 'TinyLlama 1.1B'];
    }
    if (sysInfo?.vram > 8) {
      return ['Llama 3.1 8B', 'Mistral NeMo 12B', 'Gemma 2 9B'];
    }
    return ['Llama 3.1 8B (4-bit)', 'Phi-3 Medium', 'Mistral 7B'];
  };

  return (
    <div className="space-y-6 py-4">
      {isOMSH ? (
        <>
          <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/20">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Ollama detected on {sysInfo?.gpu || 'CPU'}. {sysInfo?.ram}GB RAM available.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card className="cursor-pointer border-2 border-primary">
              <CardContent className="p-4 flex flex-col items-center">
                <div className="text-xl font-bold">Ollama</div>
                <div className="text-xs text-muted-foreground">{isLegacy ? 'Optimized for Legacy' : 'Easiest, Local-First'}</div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer border-2 border-transparent hover:border-muted opacity-50">
              <CardContent className="p-4 flex flex-col items-center">
                <div className="text-xl font-bold">vLLM</div>
                <div className="text-xs text-muted-foreground">Requires >16GB VRAM</div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-muted-foreground mb-4">
            {isLegacy 
              ? 'Legacy PC detected. Recommending lightweight, high-quantization models:' 
              : `Recommended models based on your ${sysInfo?.vram || 0}MB VRAM detection:`}
          </div>
          <ScrollArea className="h-[300px] rounded-md border p-4">
            <div className="space-y-4">
              {getRecommendedModels().map((model) => (
                <div key={model} className="flex items-center justify-between p-3 border rounded hover:bg-muted/50 cursor-pointer">
                  <div>
                    <div className="font-semibold">{model}</div>
                    <div className="text-xs text-muted-foreground">
                      {isLegacy ? 'Low latency, low RAM footprint' : 'Balanced performance'}
                    </div>
                  </div>
                  <Badge variant="secondary">Recommended</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
};

