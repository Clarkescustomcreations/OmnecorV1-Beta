import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SystemInfo } from '@/../../preload/index.d';

export const StepPreferences: React.FC<{ sysInfo: SystemInfo | null }> = ({ sysInfo }) => {
  const personalities = ['Helpful', 'Professional', 'Witty', 'Minimalist', 'Academic'];
  const [localOnly, setLocalOnly] = useState(false);
  const [autoDelete, setAutoDelete] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(true);

  return (
    <div className="space-y-8 py-4">
      <div className="space-y-4">
        <Label className="text-base font-semibold">AI Personality</Label>
        <div className="flex flex-wrap gap-2">
          {personalities.map((p) => (
            <Badge 
              key={p} 
              variant="outline" 
              className={`px-4 py-1.5 cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors ${p === 'Professional' ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {p}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>Response Style</Label>
          <span className="text-xs font-medium text-muted-foreground italic">Balanced</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Concise</span>
          <Slider defaultValue={[50]} max={100} step={1} className="flex-1" />
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Detailed</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div className="space-y-4">
          <Label className="text-base font-semibold">Privacy & Safety</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-sm">Local-Only Mode</span>
                <p className="text-[10px] text-muted-foreground">Disable all cloud fallbacks.</p>
              </div>
              <Switch checked={localOnly} onChange={setLocalOnly} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-sm">Auto-Delete History</span>
                <p className="text-[10px] text-muted-foreground">Clear chats after 24 hours.</p>
              </div>
              <Switch checked={autoDelete} onChange={setAutoDelete} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-sm">Anonymous Analytics</span>
                <p className="text-[10px] text-muted-foreground">Help improve Omnecor.</p>
              </div>
              <Switch checked={analytics} onChange={setAnalytics} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Label className="text-base font-semibold">Appearance</Label>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium">Interface Theme</span>
              <Select defaultValue="dark">
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark (OLED)</SelectItem>
                  <SelectItem value="system">System Default</SelectItem>
                  <SelectItem value="cyber">Cyberpunk (Accent)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm">Reduced Motion</span>
              <Switch checked={reducedMotion} onChange={setReducedMotion} />
            </div>
            {sysInfo?.isLegacy && (
              <p className="text-[10px] text-orange-400 italic">Recommended for your hardware.</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Encrypted Backups</Label>
            <p className="text-xs text-muted-foreground">Securely backup your knowledge base and settings.</p>
          </div>
          <Switch checked={backupEnabled} onChange={setBackupEnabled} />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Backup destination folder" defaultValue="~/Omnecor/Backups" className="flex-1 text-xs h-9" />
          <Button variant="outline" size="sm" className="h-9">Browse</Button>
        </div>
      </div>
    </div>
  );
};
