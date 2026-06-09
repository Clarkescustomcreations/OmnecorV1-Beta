import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Eye, EyeOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContextFile } from "@/lib/chatContext";

interface VisualContextMapProps {
  files: ContextFile[];
  onToggleFile?: (fileId: string) => void;
  onRemoveFile?: (fileId: string) => void;
  className?: string;
}

/**
 * Visual Context Map Component
 *
 * Interactive visualization of files currently in the AI's context.
 * Allows users to:
 * - See all files and their token contribution
 * - Toggle file inclusion/exclusion
 * - Manually eject files from context
 * - View file previews and metadata
 */
export default function VisualContextMap({
  files,
  onToggleFile,
  onRemoveFile,
  className,
}: VisualContextMapProps) {
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);

  const includedFiles = files.filter(f => f.included);
  const excludedFiles = files.filter(f => !f.included);
  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

  const getFileIcon = (type: string) => {
    switch (type) {
      case "folder":
        return "📁";
      case "file":
      default:
        return "📄";
    }
  };

  const getFileTypeColor = (filename: string) => {
    if (filename.endsWith(".ts") || filename.endsWith(".tsx"))
      return "bg-blue-500/10 border-blue-500/30";
    if (filename.endsWith(".js") || filename.endsWith(".jsx"))
      return "bg-yellow-500/10 border-yellow-500/30";
    if (filename.endsWith(".json"))
      return "bg-purple-500/10 border-purple-500/30";
    if (filename.endsWith(".md"))
      return "bg-orange-500/10 border-orange-500/30";
    return "bg-muted border-border";
  };

  const renderFileCard = (file: ContextFile) => {
    const isExpanded = expandedFileId === file.id;

    return (
      <div
        key={file.id}
        className={cn(
          "rounded-lg border transition-all",
          file.included
            ? "bg-accent/5 border-accent/30 hover:border-accent/50"
            : "bg-muted/30 border-muted/50 opacity-60"
        )}
      >
        <div className="p-3 space-y-2">
          {/* File Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{getFileIcon(file.type)}</span>
                <span className="font-mono font-medium text-sm truncate">
                  {file.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {file.path}
              </p>
            </div>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => onToggleFile?.(file.id)}
                title={
                  file.included ? "Exclude from context" : "Include in context"
                }
              >
                {file.included ? (
                  <Eye className="w-4 h-4 text-green-500" />
                ) : (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => onRemoveFile?.(file.id)}
                title="Remove from context"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* File Stats */}
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="text-xs">
              {(file.size / 1024).toFixed(1)} KB
            </Badge>
            <Badge variant="outline" className="text-xs">
              {file.tokens.toLocaleString()} tokens
            </Badge>
            <Badge variant="outline" className="text-xs">
              {file.lastModified.toLocaleDateString()}
            </Badge>
          </div>

          {/* Expandable Preview */}
          {file.preview && (
            <>
              <button
                onClick={() => setExpandedFileId(isExpanded ? null : file.id)}
                className="text-xs text-accent hover:underline"
              >
                {isExpanded ? "Hide preview" : "Show preview"}
              </button>

              {isExpanded && (
                <div
                  className={cn(
                    "p-2 rounded-md border text-xs font-mono text-muted-foreground overflow-x-auto",
                    getFileTypeColor(file.name)
                  )}
                >
                  <pre className="whitespace-pre-wrap break-words text-xs">
                    {file.preview.split("\n").slice(0, 5).join("\n")}
                    {file.preview.split("\n").length > 5 && "\n..."}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Visual Context Map</CardTitle>
        <CardDescription className="text-xs">
          Files currently in the AI's memory • Click to manage
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-muted">
            <p className="text-muted-foreground mb-1">Total Files</p>
            <p className="font-mono font-medium">{files.length}</p>
          </div>
          <div className="p-2 rounded-lg bg-accent/10 border border-accent/30">
            <p className="text-muted-foreground mb-1">Active</p>
            <p className="font-mono font-medium text-accent">
              {includedFiles.length}
            </p>
          </div>
        </div>

        {/* Files List */}
        {files.length === 0 ? (
          <div className="p-8 rounded-lg bg-muted/50 flex items-center justify-center text-center text-muted-foreground">
            <p className="text-sm">No files in context</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {/* Included Files Section */}
            {includedFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-foreground mb-2 px-1">
                  📌 Included ({includedFiles.length})
                </h3>
                <div className="space-y-2">
                  {includedFiles.map(file => renderFileCard(file))}
                </div>
              </div>
            )}

            {/* Excluded Files Section */}
            {excludedFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-2 px-1">
                  🔒 Excluded ({excludedFiles.length})
                </h3>
                <div className="space-y-2">
                  {excludedFiles.map(file => renderFileCard(file))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        {files.length > 0 && (
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              onClick={() =>
                files.forEach(f => f.included && onToggleFile?.(f.id))
              }
            >
              <EyeOff className="w-3 h-3 mr-1" />
              Exclude All
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              onClick={() =>
                files.forEach(f => !f.included && onToggleFile?.(f.id))
              }
            >
              <Eye className="w-3 h-3 mr-1" />
              Include All
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
