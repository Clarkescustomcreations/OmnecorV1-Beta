import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

export const StepOmsh: React.FC<{ sysInfo?: any }> = ({ sysInfo }) => {
  const [selectedBackend, setSelectedBackend] = useState('ollama');
  const [vram, setVram] = useState([4]);
  const [caching, setCaching] = useState(true);
  const maxVram = sysInfo?.vramTotal || 24;

  const backends = [
    { id: 'ollama', name: 'Ollama', description: 'Easiest to setup, great for most users.', icon: '🦙' },
    { id: 'vllm', name: 'vLLM', description: 'High-throughput production engine.', icon: '⚡' },
    { id: 'lmstudio', name: 'LM Studio', description: 'Local server with GUI integration.', icon: '💻' },
    { id: 'custom', name: 'Custom OpenAI-Compatible', description: 'Connect to any external API.', icon: '🔗' },
  ];

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label className="text-base font-semibold">Primary Model Backend</Label>
        <div className="grid grid-cols-2 gap-4">
          {backends.map((backend) => (
            <Card 
              key={backend.id}
              className={`cursor-pointer transition-colors ${selectedBackend === backend.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
              onClick={() => setSelectedBackend(backend.id)}
            >
              <CardContent className="p-4 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{backend.icon}</span>
                  <span className="font-bold">{backend.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">{backend.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model-storage">Model Storage Location</Label>
        <div className="flex gap-2">
          <Input id="model-storage" defaultValue="~/AI/Models" className="flex-1" />
          <Button variant="outline">Browse</Button>
        </div>
        <p className="text-xs text-muted-foreground">Path where large language models will be downloaded and stored.</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Hardware Acceleration</Label>
          <Select defaultValue="cuda">
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cuda">NVIDIA CUDA</SelectItem>
              <SelectItem value="rocm">AMD ROCm</SelectItem>
              <SelectItem value="metal">Apple Metal</SelectItem>
              <SelectItem value="cpu">CPU (No GPU)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Default Context Length</Label>
          <Select defaultValue="4096">
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2048">2k tokens</SelectItem>
              <SelectItem value="4096">4k tokens (Standard)</SelectItem>
              <SelectItem value="8192">8k tokens</SelectItem>
              <SelectItem value="16384">16k tokens</SelectItem>
              <SelectItem value="32768">32k tokens</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Label>Max VRAM Allocation (GB)</Label>
          <span className="text-sm font-mono text-primary font-bold">{vram[0]} GB</span>
        </div>
        <Slider 
          value={vram} 
          onValueChange={setVram} 
          max={maxVram} 
          min={1} 
          step={1} 
        />
        <p className="text-xs text-muted-foreground">Limit how much GPU memory the models can consume.</p>
      </div>

      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="space-y-0.5">
          <Label>Persistent Model Caching</Label>
          <p className="text-xs text-muted-foreground">Keep models in memory between sessions for instant response.</p>
        </div>
        <Switch checked={caching} onChange={setCaching} />
      </div>
    </div>
  );
};
