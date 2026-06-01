import React from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

export const StepPreferences: React.FC<{ sysInfo: any }> = ({ sysInfo }) => {
  const isLegacy = sysInfo?.isLegacy;

  return (
    <div className="space-y-8 py-4">
      <div className="space-y-4">
        <Label>AI Personality</Label>
        <RadioGroup defaultValue="professional" className="grid grid-cols-3 gap-4">
          <div>
            <RadioGroupItem value="helpful" id="helpful" className="peer sr-only" />
            <Label htmlFor="helpful" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
              <span className="text-sm font-semibold">Helpful</span>
            </Label>
          </div>
          <div>
            <RadioGroupItem value="professional" id="professional" className="peer sr-only" />
            <Label htmlFor="professional" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
              <span className="text-sm font-semibold">Professional</span>
            </Label>
          </div>
          <div>
            <RadioGroupItem value="witty" id="witty" className="peer sr-only" />
            <Label htmlFor="witty" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
              <span className="text-sm font-semibold">Witty</span>
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>Response Style (Concise vs Verbose)</Label>
          <span className="text-xs font-medium">Balanced</span>
        </div>
        <Slider defaultValue={[isLegacy ? 20 : 50]} max={100} step={1} />
      </div>

      <div className="grid grid-cols-2 gap-8 pt-4">
        <div className="space-y-4">
          <Label className="text-base">System Performance</Label>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-sm">Low-Memory Optimizations</span>
              <p className="text-xs text-muted-foreground">Reduce cache sizes</p>
            </div>
            <Switch checked={isLegacy} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-sm">Optimize Swap Buffers (ZRAM)</span>
              <p className="text-xs text-muted-foreground">
                {sysInfo?.zramEnabled 
                  ? `Active: ${sysInfo.zramSize}GB Compressed RAM` 
                  : 'Enable compressed RAM swap'}
              </p>
            </div>
            <Switch checked={isLegacy || sysInfo?.zramEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-sm">Reduced UI Animations</span>
              <p className="text-xs text-muted-foreground">Faster interface response</p>
            </div>
            <Switch checked={isLegacy} />
          </div>
        </div>
        <div className="space-y-4">
          <Label className="text-base">UI Theme</Label>
          <RadioGroup defaultValue="dark" className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="light" id="light" />
              <Label htmlFor="light">Light</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dark" id="dark" />
              <Label htmlFor="dark">Dark</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="system" id="system" />
              <Label htmlFor="system">System</Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </div>
  );
};

