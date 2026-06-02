import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export const StepNetwork: React.FC<{ sysInfo?: any }> = ({ sysInfo }) => {
  const [meshEnabled, setMeshEnabled] = useState(true);
  const [meshName, setMeshName] = useState('Omnecor-Node-1');
  const [tailscaleEnabled, setTailscaleEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fallback if sysInfo is not provided
  const ip = sysInfo?.ip || '192.168.1.15';
  const hostname = sysInfo?.hostname || 'omnecor-workstation';

  return (
    <div className="space-y-6 py-4">
      {/* Network Status */}
      <div className="p-4 border rounded-lg bg-muted/30 flex justify-between items-center">
        <div>
          <Label className="text-xs uppercase text-muted-foreground font-bold">Network Status</Label>
          <div className="flex gap-4 mt-1">
            <div>
              <span className="text-sm font-medium">IP: </span>
              <span className="text-sm text-muted-foreground">{ip}</span>
            </div>
            <div>
              <span className="text-sm font-medium">Hostname: </span>
              <span className="text-sm text-muted-foreground">{hostname}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium uppercase text-green-500">Connected</span>
        </div>
      </div>

      {/* Local mesh toggle */}
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
          <div className="space-y-0.5">
            <Label className="text-base">Local AI Mesh</Label>
            <p className="text-sm text-muted-foreground">
              Allow other devices on your network to discover and use this workstation.
            </p>
          </div>
          <Switch checked={meshEnabled} onChange={setMeshEnabled} />
        </div>

        {meshEnabled && (
          <div className="space-y-2 px-1">
            <Label htmlFor="mesh-name">Mesh Group Name</Label>
            <Input
              id="mesh-name"
              placeholder="HomeLab-AI"
              value={meshName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMeshName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Devices with the same Mesh Name will automatically find each other.
            </p>
          </div>
        )}
      </div>

      {/* Discovery Protocol */}
      <div className="space-y-2">
        <Label>Discovery Protocol</Label>
        <Select defaultValue="mdns">
          <SelectTrigger>
            <SelectValue placeholder="Select protocol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mdns">mDNS / ZeroConf (Recommended)</SelectItem>
            <SelectItem value="static">Static IP</SelectItem>
            <SelectItem value="custom">Custom Discovery</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remote access */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="space-y-0.5">
          <Label className="text-base">Remote Access (VPN)</Label>
          <p className="text-sm text-muted-foreground">
            Securely access your brain from anywhere using Tailscale or WireGuard.
          </p>
        </div>
        <Switch checked={tailscaleEnabled} onChange={setTailscaleEnabled} />
      </div>

      {/* Advanced Toggle */}
      <div className="pt-2">
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-xs text-muted-foreground"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
        </Button>
        
        {showAdvanced && (
          <div className="mt-4 grid grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/20 border-dashed">
            <div className="space-y-2">
              <Label className="text-xs">Custom Subnet</Label>
              <Input className="h-8 text-xs" placeholder="10.0.0.0/24" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">VLAN Tag</Label>
              <Input className="h-8 text-xs" placeholder="Optional" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="text-xs">Network Interface</Label>
              <Select defaultValue="auto">
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Default)</SelectItem>
                  <SelectItem value="eth0">eth0</SelectItem>
                  <SelectItem value="wlan0">wlan0</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
