import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, CheckCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HITLAlert } from "@/lib/actionHashDetector";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";
import { useAppStore } from "@/lib/store/app.store";
import { vanillaTrpc } from "@/lib/trpc";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

interface HITLAlertPanelProps {
  alert?: HITLAlert;
  onRetry?: () => void;
  onModify?: () => void;
  onAbort?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * HITL Alert Panel Component
 *
 * Displays human-in-the-loop alerts for loop detection.
 * Non-dismissible without explicit user action (retry, modify, or abort).
 */
export function HITLAlertPanel({
  alert: propAlert,
  onRetry,
  onModify,
  onAbort,
  onDismiss,
  className,
}: HITLAlertPanelProps) {
  const [selectedAction, setSelectedAction] = useState<
    "retry" | "modify" | "abort" | null
  >(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  const walletSpend = useAppStore((s) => s.walletSpend);

  // WebSocket Integration
  const { loopAlert, clearLoopAlert, clearFileEvents } = useOmnecorSocket({
    listenForLoops: true,
  });

  // Map loopAlert from WebSocket to HITLAlert format if no propAlert is provided
  const activeAlert = useMemo(() => {
    if (propAlert) return propAlert;

    if (loopAlert) {
      return {
        id: `loop-${loopAlert.actionHash}`,
        title: "Autonomous Agent Loop Detected",
        message: `Agent loop detected. Manual review required before execution can resume. Agent ID: ${loopAlert.sessionId}, Action Hash: ${loopAlert.actionHash}`,
        severity: "critical" as const,
        timestamp: new Date(),
        actionHistory: [
          {
            hash: loopAlert.actionHash,
            tool: "Autonomous Agent",
            timestamp: new Date(),
          },
        ],
        userActions: {
          retry: true,
          modify: true,
          abort: true,
        },
        resolved: false,
      };
    }

    return null;
  }, [propAlert, loopAlert]);

  // Autofocus the primary action button when alert becomes active
  useEffect(() => {
    if (activeAlert) {
      dismissButtonRef.current?.focus();
    }
  }, [activeAlert]);

  // Fire-and-forget: persist loop detection events to the audit log whenever
  // a new loop alert arrives from the WebSocket (server-side loop) or from a
  // prop alert (client-side loop created by actionHashDetector).
  useEffect(() => {
    if (!loopAlert) return;
    vanillaTrpc.ai.reportLoopViolation.mutate({
      sessionId: loopAlert.sessionId,
      hash: loopAlert.actionHash,
      consecutiveCount: loopAlert.count,
      lastActions: [],
    }).catch((err) => console.error("[HITL]", err)); // fire-and-forget — never block the UI
  }, [loopAlert]);

  if (!activeAlert) {
    return (
      <>
        {walletSpend && (
          <div className="rounded-lg border border-accent-warning/30 bg-accent-warning/10 backdrop-blur-sm p-3 shadow-lg">
            <div className="flex items-center gap-2 text-accent-warning text-sm font-medium mb-1">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Budget Spend Event</span>
            </div>
            <div className="text-xs text-accent-warning/80 space-y-0.5">
              <div className="truncate">Provider: <span className="font-mono">{walletSpend.provider}/{walletSpend.modelId}</span></div>
              <div>Cost: <span className="font-mono">${(walletSpend.costMicrocents / 100_000_000).toFixed(6)}</span></div>
            </div>
          </div>
        )}
      </>
    );
  }

  const getSeverityIcon = () => {
    switch (activeAlert.severity) {
      case "critical":
        return <AlertTriangle className="w-6 h-6 text-destructive" />;
      case "warning":
        return <AlertCircle className="w-6 h-6 text-accent-warning" />;
      default:
        return <AlertCircle className="w-6 h-6 text-primary" />;
    }
  };

  const getSeverityColor = () => {
    switch (activeAlert.severity) {
      case "critical":
        return "bg-destructive/10 border-destructive/30";
      case "warning":
        return "bg-accent-warning/10 border-accent-warning/30";
      default:
        return "bg-primary/10 border-primary/30";
    }
  };

  const handleAction = (action: "retry" | "modify" | "abort") => {
    setSelectedAction(action);

    switch (action) {
      case "retry":
        onRetry?.();
        break;
      case "modify":
        onModify?.();
        break;
      case "abort":
        onAbort?.();
        break;
    }

    // If it was a WebSocket alert, clear it after action
    if (!propAlert && loopAlert) {
      setTimeout(() => {
        clearLoopAlert();
        setSelectedAction(null);
      }, 1000);
    }
  };

  return (
    <>
      {walletSpend && (
        <div className="mb-2 rounded-lg border border-accent-warning/30 bg-accent-warning/10 backdrop-blur-sm p-3 shadow-lg">
          <div className="flex items-center gap-2 text-accent-warning text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">Budget Spend Event</span>
          </div>
          <div className="text-xs text-accent-warning/80 space-y-0.5">
            <div className="truncate">Provider: <span className="font-mono">{walletSpend.provider}/{walletSpend.modelId}</span></div>
            <div>Cost: <span className="font-mono">${(walletSpend.costMicrocents / 100_000_000).toFixed(6)}</span></div>
          </div>
        </div>
      )}
    <Card
      role="alert"
      aria-live="assertive"
      className={cn(
        "border-2 shadow-2xl animate-in fade-in zoom-in duration-300",
        getSeverityColor(),
        className
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            {getSeverityIcon()}
            <div className="flex-1">
              <CardTitle className="text-lg">{activeAlert.title}</CardTitle>
              <CardDescription className="mt-1 text-sm">
                {activeAlert.message}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={
              activeAlert.severity === "critical" ? "destructive" : "secondary"
            }
            className="text-xs"
          >
            {activeAlert.severity.toUpperCase()}
          </Badge>
          {onDismiss && (
            <HowToTooltip title="Dismiss Alert" description="Close this notification without resolving the underlying issue." side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onDismiss}
              >
                <X className="w-4 h-4" />
              </Button>
            </HowToTooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Action History Context */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Action Context</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto bg-muted/50 rounded-lg p-2">
            {activeAlert.actionHistory.map((action, index) => (
              <div
                key={`${action.hash}-${index}`}
                className="text-xs font-mono text-muted-foreground"
              >
                <span className="text-primary">#{index + 1}</span> {action.tool}{" "}
                •{" "}
                <span className="text-foreground">
                  {action.hash.substring(0, 8)}...
                </span>{" "}
                • {action.timestamp.toLocaleTimeString()}
              </div>
            ))}
          </div>
        </div>

        {/* Alert Details */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-muted">
            <p className="text-muted-foreground mb-1">Alert ID</p>
            <p className="font-mono truncate">
              {activeAlert.id.substring(0, 16)}...
            </p>
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <p className="text-muted-foreground mb-1">Triggered</p>
            <p className="font-mono">
              {activeAlert.timestamp.toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <HowToTooltip title="Acknowledge Alert" description="Clear this alert and resume normal agent operations." side="bottom">
            <Button
              ref={dismissButtonRef}
              variant="default"
              size="sm"
              className="flex-1"
              aria-label="Acknowledge and clear alert"
              onClick={() => {
                clearFileEvents();
                clearLoopAlert();
              }}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Acknowledge & Clear
            </Button>
          </HowToTooltip>
        </div>
      </CardContent>
    </Card>
    </>
  );
}
