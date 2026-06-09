import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContextTransparency } from "@/lib/chatContext";

interface ContextTransparencyIndicatorProps {
  transparency: ContextTransparency;
  className?: string;
}

/**
 * Context Transparency Indicator Component
 *
 * Displays real-time information about what data is currently in the AI's memory,
 * including token usage, file inclusion status, and remaining context capacity.
 *
 * Features:
 * - Visual progress bar showing token usage
 * - Breakdown of system prompt, conversation, and file tokens
 * - File inclusion status with quick toggle
 * - Warning indicators for high token usage
 */
export default function ContextTransparencyIndicator({
  transparency,
  className,
}: ContextTransparencyIndicatorProps) {
  const getStatusIcon = () => {
    if (transparency.usedPercentage >= 90) {
      return <AlertCircle className="w-5 h-5 text-red-500" />;
    } else if (transparency.usedPercentage >= 70) {
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    } else {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
  };

  const getStatusLabel = () => {
    if (transparency.usedPercentage >= 90) {
      return "Critical";
    } else if (transparency.usedPercentage >= 70) {
      return "High";
    } else if (transparency.usedPercentage >= 40) {
      return "Moderate";
    } else {
      return "Low";
    }
  };

  const getProgressColor = () => {
    if (transparency.usedPercentage >= 90) {
      return "bg-red-500";
    } else if (transparency.usedPercentage >= 70) {
      return "bg-yellow-500";
    } else {
      return "bg-green-500";
    }
  };

  const includedFilesCount = transparency.files.filter(f => f.included).length;
  const totalFilesCount = transparency.files.length;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Context Transparency</CardTitle>
            <CardDescription className="text-xs">
              Real-time memory usage and file inclusion status
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <Badge
              variant={
                transparency.usedPercentage >= 90
                  ? "destructive"
                  : transparency.usedPercentage >= 70
                    ? "secondary"
                    : "outline"
              }
            >
              {getStatusLabel()}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Token Usage Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Token Usage</span>
            <span className="font-mono font-medium">
              {transparency.totalTokens.toLocaleString()} /{" "}
              {transparency.maxTokens.toLocaleString()}
            </span>
          </div>
          <Progress value={transparency.usedPercentage} className="h-2" />
          <div className="text-xs text-muted-foreground">
            {transparency.usedPercentage.toFixed(1)}% used •{" "}
            {transparency.remainingTokens.toLocaleString()} remaining
          </div>
        </div>

        {/* Token Breakdown */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-muted">
            <p className="text-muted-foreground mb-1">System</p>
            <p className="font-mono font-medium">
              {transparency.systemPromptTokens.toLocaleString()}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <p className="text-muted-foreground mb-1">Context</p>
            <p className="font-mono font-medium">
              {transparency.conversationTokens.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Warnings */}
        {transparency.usedPercentage >= 70 && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              ⚠️ High context usage. Consider removing files or starting a new
              conversation.
            </p>
          </div>
        )}

        {transparency.usedPercentage >= 90 && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-xs text-red-700 dark:text-red-400">
              🚨 Critical context usage. Remove files immediately to continue.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
