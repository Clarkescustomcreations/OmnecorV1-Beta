/**
 * Audit Log Retention — Settings → Security section.
 *
 * The audit log is append-only; without a retention window it grows without
 * bound. Default is 2 weeks (auto-purged on a 6-hour sweep server-side);
 * admins can switch to 4 weeks or permanent. Permanent shows a storage
 * warning with the current table size.
 */
import { trpc } from "../../lib/trpc";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Badge } from "../ui/badge";
import { Archive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type RetentionDays = 14 | 28 | 0;

const OPTIONS: { value: RetentionDays; label: string; description: string }[] = [
  { value: 14, label: "2 weeks (recommended)", description: "Entries older than 14 days are deleted automatically. Default." },
  { value: 28, label: "4 weeks", description: "Entries older than 28 days are deleted automatically." },
  { value: 0, label: "Permanent", description: "Nothing is ever deleted. The log will grow indefinitely." },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function AuditRetentionPanel() {
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  const retentionQuery = trpc.audit.getRetention.useQuery(undefined, {
    enabled: isAdmin,
  });
  const setRetentionMutation = trpc.audit.setRetention.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.retentionDays === 0
          ? "Audit log retention set to permanent"
          : `Audit log retention set to ${res.retentionDays} days${res.purged > 0 ? ` — ${res.purged} expired entries purged` : ""}`
      );
      retentionQuery.refetch();
    },
    onError: (err) => toast.error("Failed to update retention: " + err.message),
  });

  if (!isAdmin) return null;

  const data = retentionQuery.data;
  const current = (data?.retentionDays ?? 14) as RetentionDays;

  return (
    <div className="pt-6 border-t space-y-6">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Archive className="w-5 h-5 text-blue-400" /> Audit Log Retention
      </h3>
      <p className="text-xs text-muted-foreground">
        The audit log is append-only. To keep it from consuming unbounded storage, entries outside the
        retention window are purged automatically (checked every 6 hours).
      </p>

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {data.dbActive ? (
            <>
              <Badge variant="secondary">{data.entries.toLocaleString()} entries</Badge>
              <Badge variant="secondary">~{formatBytes(data.approxBytes)}</Badge>
              {data.oldestEntryAt && (
                <span className="break-all">oldest: {new Date(data.oldestEntryAt).toLocaleDateString()}</span>
              )}
            </>
          ) : (
            <span>
              Audit log persistence requires MySQL — in SQLite (Sovereign) mode entries are not stored,
              so retention has no effect.
            </span>
          )}
        </div>
      )}

      <RadioGroup
        value={String(current)}
        onValueChange={(v) => setRetentionMutation.mutate({ retentionDays: Number(v) as RetentionDays })}
        disabled={setRetentionMutation.isPending}
      >
        {OPTIONS.map((opt) => (
          <div key={opt.value} className="flex items-start gap-3 rounded-md border p-3">
            <RadioGroupItem value={String(opt.value)} id={`audit-retention-${opt.value}`} className="mt-0.5" />
            <div className="min-w-0">
              <Label htmlFor={`audit-retention-${opt.value}`} className="font-medium cursor-pointer">
                {opt.label}
              </Label>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </div>
        ))}
      </RadioGroup>

      {current === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-600 dark:text-amber-400 break-words">
            <span className="font-semibold">Storage warning:</span> with permanent retention the audit log is
            never pruned and can grow very large over time
            {data?.dbActive ? ` (currently ${data.entries.toLocaleString()} entries, ~${formatBytes(data.approxBytes)})` : ""}.
            Every tRPC call is logged, so busy workstations can add tens of thousands of entries per week.
            Export and switch back to a timed window periodically if disk space matters.
          </p>
        </div>
      )}
    </div>
  );
}
