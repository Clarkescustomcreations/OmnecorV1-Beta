import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Smartphone, QrCode, RefreshCw, Trash2, Wifi } from "lucide-react";

/**
 * Payload encoded in the pairing QR. The Omnecor HQ app scans it to set the PC
 * address AND pair in one step (it redeems with the high-entropy `secret`).
 */
function buildQrPayload(host: string | null, port: number, secret: string): string {
  return `omnecor://pair?host=${encodeURIComponent(host ?? "")}&port=${port}&secret=${encodeURIComponent(secret)}`;
}

function relativeTime(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PairDevicePanel() {
  const devicesQuery = trpc.pairing.listDevices.useQuery();
  const createCode = trpc.pairing.createCode.useMutation();
  const revokeDevice = trpc.pairing.revokeDevice.useMutation();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const active = createCode.data; // { code, secret, expiresAt, host, port }

  // Render the QR whenever a fresh code is created.
  useEffect(() => {
    if (!active) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(buildQrPayload(active.host, active.port, active.secret), { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [active]);

  // Live TTL countdown for the active code.
  useEffect(() => {
    if (!active) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((active.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active]);

  const expired = !!active && secondsLeft <= 0;

  const handleGenerate = useCallback(() => {
    createCode.mutate(undefined, {
      onError: (e) => toast.error("Could not create a pairing code: " + e.message),
    });
  }, [createCode]);

  const handleRevoke = useCallback(
    (deviceId: string, name: string) => {
      revokeDevice.mutate(
        { deviceId },
        {
          onSuccess: () => {
            toast.success(`Revoked "${name}"`);
            void devicesQuery.refetch();
          },
          onError: (e) => toast.error("Revoke failed: " + e.message),
        },
      );
    },
    [revokeDevice, devicesQuery],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Pair the Omnecor HQ app
          </CardTitle>
          <CardDescription>
            Open Omnecor HQ on your phone and scan the QR, or type the 6-digit code — no login needed, the
            code authorizes your phone to this PC. On the same Wi-Fi with a shared OMMESH secret, phones pair
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!active || expired ? (
            <Button onClick={handleGenerate} disabled={createCode.isPending}>
              <QrCode className="h-4 w-4 mr-2" />
              {createCode.isPending ? "Generating…" : expired ? "Generate a new code" : "Pair a device"}
            </Button>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Pairing QR code"
                  width={220}
                  height={220}
                  className="rounded-lg border border-border bg-background p-2"
                />
              )}
              <div className="space-y-2 text-center sm:text-left">
                <p className="text-sm text-muted-foreground">Or enter this code in the app:</p>
                <p className="font-mono text-3xl font-bold tracking-widest tabular-nums">{active.code}</p>
                <p className="text-xs text-muted-foreground">
                  PC address: <span className="font-mono">{active.host ?? "—"}:{active.port}</span>
                </p>
                <p className="text-xs text-muted-foreground">Expires in {secondsLeft}s</p>
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={createCode.isPending}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> New code
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" /> Paired devices
          </CardTitle>
          <CardDescription>Phones paired to this PC. Revoke a device to sign it out immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          {devicesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !devicesQuery.data?.devices.length ? (
            <p className="text-sm text-muted-foreground">No devices paired yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {devicesQuery.data.devices.map((d) => {
                const revoked = !!d.revokedAt;
                return (
                  <li key={d.deviceId} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{d.name}</span>
                        <Badge variant={d.pairMethod === "ommesh" ? "default" : "secondary"} className="text-xs">
                          {d.pairMethod === "ommesh" ? "OMMESH" : "Code"}
                        </Badge>
                        {revoked && (
                          <Badge variant="destructive" className="text-xs">
                            Revoked
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Last seen {relativeTime(new Date(d.lastSeenAt))}
                      </p>
                    </div>
                    {!revoked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(d.deviceId, d.name)}
                        disabled={revokeDevice.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
