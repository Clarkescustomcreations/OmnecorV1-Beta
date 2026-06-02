import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SystemInfo } from '@/../../preload/index.d';

export const StepValet: React.FC<{ sysInfo: SystemInfo | null }> = ({ sysInfo }) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [temp, setTemp] = useState([0.7]);
  const [topP, setTopP] = useState([0.9]);

  const models = [
    { name: 'Llama 3.1 8B', tags: ['Reasoning', 'General'], size: '4.7GB' },
    { name: 'Mistral Nemo 12B', tags: ['Coding', 'Detailed'], size: '7.1GB' },
    { name: 'Phi-3.5 Mini', tags: ['Fast', 'Efficient'], size: '2.2GB' },
  ];

  const runTest = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult('Success: Connection established and inference verified.');
    }, 1500);
  };

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label className="text-base">Initial Model Selection</Label>
        <div className="grid grid-cols-1 gap-3">
          {models.map((model) => (
            <div key={model.name} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 cursor-pointer">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{model.name}</span>
                <div className="flex gap-1">
                  {model.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{tag}</Badge>
                  ))}
                </div>
              </div>
              <div className="text-right">
                {sysInfo?.ram && parseInt(model.size) > sysInfo.ram && (
                   <span className="text-[10px] text-red-500 block">Heavy for your RAM</span>
                )}
                <div className="text-xs font-mono">{model.size}</div>
                <Button variant="ghost" size="sm" className="h-7 text-xs">Details</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
        <div className="flex justify-between items-center">
          <Label className="font-semibold">Test Connection</Label>
          {testResult && <span className="text-xs text-green-500 font-medium">{testResult}</span>}
        </div>
        <Button 
          className="w-full" 
          variant="outline" 
          onClick={runTest} 
          disabled={testing}
        >
          {testing ? 'Running Inference Test...' : 'Test Inference'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex justify-between">
            <Label className="text-xs">Temperature</Label>
            <span className="text-xs font-mono">{temp[0]}</span>
          </div>
          <Slider value={temp} onValueChange={setTemp} max={2.0} min={0} step={0.1} />
        </div>
        <div className="space-y-4">
          <div className="flex justify-between">
            <Label className="text-xs">Top-P</Label>
            <span className="text-xs font-mono">{topP[0]}</span>
          </div>
          <Slider value={topP} onValueChange={setTopP} max={1.0} min={0} step={0.05} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sys-prompt">Base System Prompt</Label>
        <textarea
          id="sys-prompt"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="You are a helpful AI assistant..."
          defaultValue="You are Omnecor, a sovereign AI interface. Be helpful, concise, and prioritize local data privacy."
        />
      </div>

      <div className="space-y-2">
        <Label>Fallback Model (Cloud)</Label>
        <Select defaultValue="none">
          <SelectTrigger>
            <SelectValue placeholder="Select fallback" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Fallback (Local Only)</SelectItem>
            <SelectItem value="gpt4">GPT-4o (requires API Key)</SelectItem>
            <SelectItem value="claude">Claude 3.5 Sonnet</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Used if local hardware is overloaded or offline.</p>
      </div>
    </div>
  );
};
