import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const StepKnowledgeBase: React.FC<{ type: string }> = ({ type }) => {
  const isCreative = type === 'creative';

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label>{isCreative ? 'Creative Writing Folder' : 'Root Knowledge Folder'}</Label>
        <div className="flex gap-2">
          <Input placeholder="~/AI/Brain" defaultValue={isCreative ? '~/AI/Brain/Creative' : '~/AI/Brain'} />
          <Button variant="outline">Browse</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {isCreative 
            ? 'Specialized map for storytelling, world-building, and character consistency.'
            : 'Select the main directory where your documents, notes, and research are stored.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Embedding Model</Label>
          <Select defaultValue="local">
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">nomic-embed-text (Local)</SelectItem>
              <SelectItem value="openai">text-embedding-3-small (Cloud)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vector Database</Label>
          <Select defaultValue="chroma">
            <SelectTrigger>
              <SelectValue placeholder="Select DB" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chroma">ChromaDB (Local)</SelectItem>
              <SelectItem value="lancedb">LanceDB (Serverless)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isCreative && (
        <div className="p-4 border rounded-lg bg-muted/30">
          <h4 className="font-semibold text-sm mb-2">Indexing Options</h4>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs">Recursive Scan</span>
              <Switch checked />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Summarize on Ingest</span>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Auto-Reindex</span>
              <Switch checked />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

