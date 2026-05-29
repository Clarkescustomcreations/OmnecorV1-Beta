import React, { useState, useMemo } from "react";
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
export default function HITLAlertPanel({
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

  // WebSocket Integration
  const { loopAlert, clearLoopAlert } = useOmnecorSocket({
    listenForLoops: true,
  });

  // Map loopAlert from WebSocket to HITLAlert format if no propAlert is provided
  const activeAlert = useMemo(() => {
    if (propAlert) return propAlert;

    if (loopAlert) {
      return {
        id: `loop-${loopAlert.actionHash}`,
        title: "Autonomous Agent Loop Detected",
        message: `The agent has repeated the same action sequence ${loopAlert.count} times. Human intervention required to continue safely.`,
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

  if (!activeAlert) return null;

  const getSeverityIcon = () => {
    switch (activeAlert.severity) {
      case "critical":
        return <AlertTriangle className="w-6 h-6 text-red-500" />;
      case "warning":
        return <AlertCircle className="w-6 h-6 text-yellow-500" />;
      default:
        return <AlertCircle className="w-6 h-6 text-blue-500" />;
    }
  };

  const getSeverityColor = () => {
    switch (activeAlert.severity) {
      case "critical":
        return "bg-red-500/10 border-red-500/30";
      case "warning":
        return "bg-yellow-500/10 border-yellow-500/30";
      default:
        return "bg-blue-500/10 border-blue-500/30";
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
    <Card
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDismiss}
            >
              <X className="w-4 h-4" />
            </Button>
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
                <span className="text-accent">#{index + 1}</span> {action.tool}{" "}
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
          {activeAlert.userActions.retry && (
            <Button
              variant={selectedAction === "retry" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => handleAction("retry")}
              disabled={activeAlert.resolved && selectedAction !== "retry"}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Retry
            </Button>
          )}
          {activeAlert.userActions.modify && (
            <Button
              variant={selectedAction === "modify" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => handleAction("modify")}
              disabled={activeAlert.resolved && selectedAction !== "modify"}
            >
              ✏️ Modify
            </Button>
          )}
          {activeAlert.userActions.abort && (
            <Button
              variant={selectedAction === "abort" ? "destructive" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => handleAction("abort")}
              disabled={activeAlert.resolved && selectedAction !== "abort"}
            >
              <X className="w-4 h-4 mr-2" />
              Abort
            </Button>
          )}
        </div>

        {/* Resolution Status */}
        {activeAlert.resolved && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <p className="text-xs text-green-700 dark:text-green-400">
              ✓ Alert resolved with action:{" "}
              <span className="font-semibold">
                {"userDecision" in activeAlert
                  ? (activeAlert as any).userDecision
                  : "N/A"}
              </span>
            </p>
          </div>
        )}

        {/* Warning */}
        <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            ⚠️ This alert cannot be dismissed until you take action. Choose
            Retry, Modify, or Abort.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
