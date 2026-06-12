/**
 * useJobs — live PC background-job list.
 *
 * Read path:  initial snapshot via `jobs.list`, then live updates from the
 *             "training:all" WS channel (lifecycle = state changes,
 *             trainingProgress = streamed progress payloads).
 * Write path: `jobs.cancel` mutation. (The PC exposes cancel only — there is no
 *             pause/resume in ProcessManagerService.)
 *
 * Job shape mirrors ProcessStatus from
 * OmnecorV1-Beta/server/phase2/services/ProcessManagerService.ts.
 */
import { useState, useEffect, useCallback } from "react";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { subscribeChannel } from "@/lib/_core/ws-channels";
import { isServerConfigured } from "@/lib/_core/server-config";

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  jobId: string;
  type: string;
  label: string;
  state: JobState;
  startedAt: string | null;
  completedAt: string | null;
  lastProgress: Record<string, any> | null;
}

/** Best-effort progress percentage (0–100) from a job's streamed payload. */
export function jobPercent(job: Job): number | null {
  const p = job.lastProgress;
  if (!p) return null;
  const raw =
    p.percent ?? p.progress ?? p.pct ??
    (typeof p.step === "number" && typeof p.total === "number" && p.total > 0
      ? (p.step / p.total) * 100
      : undefined);
  if (typeof raw !== "number" || Number.isNaN(raw)) return null;
  return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
}

export function useJobs() {
  const [jobs, setJobs]       = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isServerConfigured()) {
      setError("No server configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery<{ total: number; jobs: Job[] }>("jobs.list");
      setJobs(res?.jobs ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeChannel("training:all", (data: any, type: string) => {
      if (!data?.jobId) return;

      if (type === "lifecycle") {
        setJobs((prev) => {
          if (prev.some((j) => j.jobId === data.jobId)) {
            return prev.map((j) =>
              j.jobId === data.jobId
                ? { ...j, state: data.state ?? j.state, label: data.label ?? j.label, type: data.type ?? j.type }
                : j
            );
          }
          // A job we hadn't seen yet — prepend it.
          return [
            {
              jobId: data.jobId,
              type: data.type ?? "custom",
              label: data.label ?? data.jobId,
              state: (data.state ?? "running") as JobState,
              startedAt: data.timestamp ?? null,
              completedAt: null,
              lastProgress: null,
            },
            ...prev,
          ];
        });
      } else {
        // trainingProgress — attach the latest payload, promote queued → running
        setJobs((prev) =>
          prev.map((j) =>
            j.jobId === data.jobId
              ? { ...j, lastProgress: data.data ?? j.lastProgress, state: j.state === "queued" ? "running" : j.state }
              : j
          )
        );
      }
    });
    return unsub;
  }, [refresh]);

  const cancel = useCallback(async (jobId: string) => {
    // Optimistic state flip; reconcile from the server afterwards.
    setJobs((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, state: "cancelled" } : j)));
    try {
      await trpcMutate("jobs.cancel", { jobId });
    } catch (e) {
      setError(String(e));
    } finally {
      refresh();
    }
  }, [refresh]);

  return { jobs, loading, error, refresh, cancel };
}
