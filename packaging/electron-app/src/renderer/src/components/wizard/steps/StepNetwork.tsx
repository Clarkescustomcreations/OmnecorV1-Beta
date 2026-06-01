import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const StepNetwork: React.FC = () => {
  const [meshEnabled, setMeshEnabled] = useState(true);
  const [meshName, setMeshName] = useState('Omnecor-Node-1');
  const [tailscaleEnabled, setTailscaleEnabled] = useState(false);

  // Android thin-client: configurable backend server IP
  const isAndroid = typeof (window as any).Capacitor !== 'undefined';
  const [serverIP, setServerIP] = useState('');

  return (
    <div className="space-y-8 py-4">

      {/* Android thin-client server config */}
      {isAndroid && (
        <div className="p-4 border rounded-lg bg-blue-500/10 border-blue-500/20 space-y-3">
          <Label className="text-base font-semibold text-blue-400">Desktop Brain Address</Label>
          <p className="text-sm text-muted-foreground">
            Enter the IP address of your Omnecor desktop workstation on the local network.
          </p>
          <Input
            id="server-ip"
            placeholder="192.168.1.100"
            value={serverIP}
            onChange={(e) => {
              setServerIP(e.target.value);
              localStorage.setItem('omnecor_server_ip', e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Stored locally — the app will connect to port 3000 on that IP.
          </p>
        </div>
      )}

      {/* Local mesh toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
        <div className="space-y-0.5">
          <Label className="text-base">Local AI Mesh</Label>
          <p className="text-sm text-muted-foreground">
            Allow other devices on your network to discover and use this workstation.
          </p>
        </div>
        <Switch checked={meshEnabled} onCheckedChange={setMeshEnabled} />
      </div>

      {/* Mesh name */}
      <div className="space-y-2">
        <Label htmlFor="mesh-name">Mesh Name</Label>
        <Input
          id="mesh-name"
          placeholder="HomeLab-AI"
          value={meshName}
          onChange={(e) => setMeshName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          How this workstation appears on the local network.
        </p>
      </div>

      {/* Discovery + Remote access cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 border rounded-lg">
          <h4 className="font-semibold mb-2">Discovery Protocol</h4>
          <p className="text-sm text-muted-foreground mb-4">mDNS / ZeroConf (Recommended)</p>
          <Button variant="outline" size="sm">Configure</Button>
        </div>
        <div className="p-4 border rounded-lg">
          <h4 className="font-semibold mb-2">Remote Access</h4>
          <p className="text-sm text-muted-foreground mb-4">Tailscale / WireGuard Integration</p>
          <Switch checked={tailscaleEnabled} onCheckedChange={setTailscaleEnabled} />
        </div>
      </div>
    </div>
  );
};
