/**
 * @file client/src/components/agents/RecursiveMASPanel.tsx
 * @description Omnecor — RecursiveMAS Multi-Agent System Panel (Phase 26)
 *
 * Allows the user to configure and monitor a RecursiveMAS crew:
 *  - Form: goal, agent IDs (comma-separated), max iterations, execution mode
 *  - "Launch Crew" → calls trpc.agent.runRecursiveMAS
 *  - Live status polling every 3 s
 *  - Scrollable message feed with agent badges and flagged warnings
 *  - Stop button while job is running
 *  - Result displayed in a code block on completion
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

// ── Types (mirrored from server for self-containment) ─────────────────────────

type ExecutionMode = "sequential" | "hierarchical" | "parallel";

interface AgentMessage {
  agentId: string;
  role: string;
  content: string;
  timestamp: number;
  flagged: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecursiveMASPanel() {
  // Form state
  const [goal, setGoal] = useState("");
  const [agentIdsRaw, setAgentIdsRaw] = useState("");
  const [maxIterations, setMaxIterations] = useState(10);
  const [mode, setMode] = useState<ExecutionMode>("sequential");

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── tRPC mutations / queries ──────────────────────────────────────────────

  const runMutation = trpc.agent.runRecursiveMAS.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      setLaunchError(null);
    },
    onError: (err) => {
      setLaunchError(err.message);
    },
  });

  const statusQuery = trpc.agent.getRecursiveMASStatus.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: !!jobId,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (data?.status === "complete" || data?.status === "failed") return false;
        return 3000;
      },
    }
  );

  // ── Derived values ────────────────────────────────────────────────────────

  const agentIds = agentIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const status = statusQuery.data;
  const isRunning = status?.status === "running";
  const isComplete = status?.status === "complete";
  const isFailed = status?.status === "failed";

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleLaunch() {
    if (!goal.trim()) return;
    setJobId(null);
    setLaunchError(null);
    runMutation.mutate({
      goal: goal.trim(),
      agentIds: agentIds.length > 0 ? agentIds : ["agent_0"],
      maxIterations,
      mode,
    });
  }

  const stopMutation = trpc.agent.stopRecursiveMAS.useMutation({
    onSuccess: () => toast.success("Agent crew stopped"),
    onError: (err) => toast.error("Failed to stop: " + err.message),
  });

  function handleStop() {
    if (!jobId) return;
    stopMutation.mutate({ jobId });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      {/* ── Header ── */}
      <div>
        <h2 className="text-lg font-semibold">RecursiveMAS Crew</h2>
        <p className="text-sm text-muted-foreground">
          Configure and launch a multi-agent crew powered by the RecursiveMAS bridge.
        </p>
      </div>

      {/* ── Configuration Form ── */}
      <div className="flex flex-col gap-3 border rounded-lg p-4 bg-card">
        {/* Goal */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="mas-goal">
            Goal
          </label>
          <Textarea
            id="mas-goal"
            placeholder="Describe what the crew should accomplish…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Agent IDs */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="mas-agents">
            Agent IDs{" "}
            <span className="font-normal text-muted-foreground">(comma-separated)</span>
          </label>
          <Input
            id="mas-agents"
            placeholder="researcher, writer, critic"
            value={agentIdsRaw}
            onChange={(e) => setAgentIdsRaw(e.target.value)}
          />
          {agentIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {agentIds.map((id) => (
                <Badge key={id} variant="secondary">
                  {id}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Max iterations + mode (row) */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-sm font-medium" htmlFor="mas-iterations">
              Max Iterations
            </label>
            <Input
              id="mas-iterations"
              type="number"
              min={1}
              max={50}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1 flex-1">
            <label className="text-sm font-medium">Execution Mode</label>
            <Select value={mode} onValueChange={(v) => setMode(v as ExecutionMode)}>
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">Sequential</SelectItem>
                <SelectItem value="hierarchical">Hierarchical</SelectItem>
                <SelectItem value="parallel">Parallel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Launch button */}
        <Button
          onClick={handleLaunch}
          disabled={runMutation.isPending || !goal.trim()}
          className="self-start"
        >
          {runMutation.isPending ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Launching…
            </>
          ) : (
            "Launch Crew"
          )}
        </Button>

        {launchError && (
          <p className="text-sm text-destructive">{launchError}</p>
        )}
      </div>

      {/* ── Status Panel ── */}
      {jobId && (
        <div className="flex flex-col gap-3 border rounded-lg p-4 bg-card flex-1 min-h-0">
          {/* Status header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Job</span>
              <code className="text-xs text-muted-foreground">{jobId}</code>
            </div>

            <div className="flex items-center gap-2">
              {isRunning && (
                <>
                  <Spinner className="h-4 w-4 text-blue-500" />
                  <Badge variant="outline" className="text-blue-600 border-blue-400">
                    Running
                  </Badge>
                  <Button size="sm" variant="destructive" onClick={handleStop}>
                    Stop
                  </Button>
                </>
              )}
              {isComplete && (
                <Badge className="bg-green-600 text-white">
                  ✓ Complete
                </Badge>
              )}
              {isFailed && (
                <Badge variant="destructive">
                  ✗ Failed
                </Badge>
              )}
              {statusQuery.isLoading && !status && (
                <Spinner className="h-4 w-4" />
              )}
            </div>
          </div>

          {/* Message feed */}
          <ScrollArea className="flex-1 max-h-64 border rounded-md p-2 bg-background">
            {(status?.messages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {isRunning ? "Waiting for agent messages…" : "No messages yet."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {(status?.messages ?? []).map((msg: AgentMessage, i: number) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-1 rounded-md p-2 text-sm ${
                      msg.flagged ? "bg-destructive/10 border border-destructive/30" : "bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {msg.agentId}
                      </Badge>
                      <span className="text-xs text-muted-foreground capitalize">
                        {msg.role}
                      </span>
                      {msg.flagged && (
                        <Badge variant="destructive" className="text-xs">
                          ⚠ Flagged
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Final result */}
          {isComplete && status?.result && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Result</span>
              <pre className="rounded-md border bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                {status.result}
              </pre>
            </div>
          )}

          {isFailed && status?.result && (
            <div className="text-sm text-destructive">
              <span className="font-medium">Error: </span>
              {status.result}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
