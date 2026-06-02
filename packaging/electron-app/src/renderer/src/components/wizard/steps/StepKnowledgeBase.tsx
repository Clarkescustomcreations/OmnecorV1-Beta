import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const StepKnowledgeBase: React.FC<{ type: 'brain' | 'creative' }> = ({ type }) => {
  const isCreative = type === 'creative';
  const [bible, setBible] = useState(true);
  const [consistency, setConsistency] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [recursive, setRecursive] = useState(true);
  const [ocr, setOcr] = useState(false);
  const [reindex, setReindex] = useState(true);
  const [deepSum, setDeepSum] = useState(false);

  const fileTypes = [
    { id: 'pdf', label: 'PDF' },
    { id: 'md', label: 'Markdown' },
    { id: 'txt', label: 'Text' },
    { id: 'docx', label: 'Word' },
    { id: 'json', label: 'JSON' },
    { id: 'epub', label: 'EPUB' },
  ];

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label className="text-base font-semibold">
          {isCreative ? 'Creative Writing Vault' : 'Neural Knowledge Base'}
        </Label>
        <p className="text-sm text-muted-foreground">
          {isCreative 
            ? 'Connect your fiction projects, character bibles, and world lore.'
            : 'Select the primary folder for your personal research, notes, and documents.'}
        </p>
        <div className="flex gap-2 pt-2">
          <Input 
            placeholder={isCreative ? '~/Writing/Projects' : '~/Documents/Brain'} 
            defaultValue={isCreative ? '~/Omnecor/Creative' : '~/Omnecor/Knowledge'} 
          />
          <Button variant="outline">Browse</Button>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-sm">File Types to Index</Label>
        <div className="grid grid-cols-3 gap-2">
          {fileTypes.map((ft) => (
            <label key={ft.id} className="flex items-center gap-2 p-2 border rounded hover:bg-muted/50 cursor-pointer transition-colors">
              <input type="checkbox" defaultChecked className="rounded border-input bg-background" />
              <span className="text-xs font-medium">{ft.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Embedding Engine</Label>
          <Select defaultValue="local">
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Nomic Embed (Local)</SelectItem>
              <SelectItem value="openai">OpenAI (Cloud)</SelectItem>
              <SelectItem value="cohere">Cohere (Cloud)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vector Database</Label>
          <Select defaultValue="chroma">
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chroma">ChromaDB (Default)</SelectItem>
              <SelectItem value="qdrant">Qdrant</SelectItem>
              <SelectItem value="milvus">Milvus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isCreative ? (
        <div className="p-4 border rounded-lg bg-purple-500/5 border-purple-500/20 space-y-4">
          <h4 className="text-sm font-bold text-purple-600 dark:text-purple-400">Creative Writing Features</h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium">Character Bible Memory</span>
                <p className="text-[10px] text-muted-foreground">Track traits and history for every character.</p>
              </div>
              <Switch checked={bible} onChange={setBible} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium">Lore Consistency Engine</span>
                <p className="text-[10px] text-muted-foreground">Prevent plot holes and world-building errors.</p>
              </div>
              <Switch checked={consistency} onChange={setConsistency} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium">Story Arc Tracking</span>
                <p className="text-[10px] text-muted-foreground">Map narrative beats and pacing across files.</p>
              </div>
              <Switch checked={tracking} onChange={setTracking} />
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 border rounded-lg bg-blue-500/5 border-blue-500/20 space-y-4">
          <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400">Knowledge Indexing</h4>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs">Recursive Scan</span>
              <Switch checked={recursive} onChange={setRecursive} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">OCR Support</span>
              <Switch checked={ocr} onChange={setOcr} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Auto-Reindex</span>
              <Switch checked={reindex} onChange={setReindex} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Deep Summarization</span>
              <Switch checked={deepSum} onChange={setDeepSum} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
