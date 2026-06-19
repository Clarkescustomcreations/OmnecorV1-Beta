/**
 * Omnecor Component Library
 *
 * A comprehensive collection of reusable, accessible, and consistently-styled
 * components built on shadcn/ui and Tailwind CSS. All components follow the
 * dark OKLCH design system and are optimized for the AI workbench interface.
 *
 * This library provides:
 * - Status indicators (success, warning, error, loading)
 * - File type icons and badges
 * - Loading states and skeletons
 * - Error boundaries and feedback
 * - Keyboard-accessible controls
 * - Tooltips and help text
 */

import React from "react";
import {
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Loader2,
  FileText,
  Folder,
  Code,
  Image,
  Music,
  File,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

/**
 * Status Indicator Component
 * Shows the status of an operation or system state
 */
export interface StatusIndicatorProps {
  status: "success" | "warning" | "error" | "loading" | "idle";
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function StatusIndicator({
  status,
  label,
  size = "md",
}: StatusIndicatorProps) {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };

  const statusConfig = {
    success: { color: "bg-accent-success", icon: CheckCircle, label: "Success" },
    warning: { color: "bg-accent-danger", icon: AlertTriangle, label: "Warning" },
    error: { color: "bg-destructive", icon: AlertCircle, label: "Error" },
    loading: {
      color: "bg-accent-cyan animate-pulse",
      icon: Loader2,
      label: "Loading",
    },
    idle: { color: "bg-muted-foreground", icon: File, label: "Idle" },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <div
              className={`${sizeClasses[size]} ${config.color} rounded-full`}
            />
            {label && (
              <span className="text-sm text-foreground/70">{label}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>{config.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * File Type Icon Component
 * Displays appropriate icon for different file types
 */
export interface FileTypeIconProps {
  fileType: "folder" | "text" | "code" | "image" | "audio" | "unknown";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FileTypeIcon({
  fileType,
  size = "md",
  className = "",
}: FileTypeIconProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  const icons = {
    folder: Folder,
    text: FileText,
    code: Code,
    image: Image,
    audio: Music,
    unknown: File,
  };

  const Icon = icons[fileType];
  const colorClass = fileType === "folder" ? "text-accent-cyan" : "text-muted-foreground";

  return <Icon className={`${sizeClasses[size]} ${colorClass} ${className}`} />;
}

/**
 * File Type Badge Component
 * Shows file type with icon and label
 */
export interface FileTypeBadgeProps {
  fileType: "folder" | "text" | "code" | "image" | "audio" | "unknown";
  label?: string;
}

export function FileTypeBadge({ fileType, label }: FileTypeBadgeProps) {
  const typeLabels = {
    folder: "Folder",
    text: "Text",
    code: "Code",
    image: "Image",
    audio: "Audio",
    unknown: "File",
  };

  return (
    <Badge variant="outline" className="flex items-center gap-1">
      <FileTypeIcon fileType={fileType} size="sm" />
      {label || typeLabels[fileType]}
    </Badge>
  );
}

/**
 * Loading Skeleton Component
 * Placeholder for content while loading
 */
export interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({
  width = "w-full",
  height = "h-4",
  className = "",
}: SkeletonProps) {
  return (
    <div
      className={`${width} ${height} bg-gradient-to-r from-background via-muted to-background animate-pulse rounded ${className}`}
    />
  );
}

/**
 * Loading Card Skeleton
 * Full card placeholder for loading state
 */
export function CardSkeleton() {
  return (
    <div className="p-4 bg-card rounded-lg border border-border">
      <Skeleton height="h-6" className="mb-3" />
      <Skeleton height="h-4" className="mb-2" />
      <Skeleton height="h-4" width="w-3/4" />
    </div>
  );
}

/**
 * Error Boundary Component
 * Catches errors and displays user-friendly message
 */
export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps> {
  state: { hasError: boolean; error: Error | null } = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-4 bg-destructive/10 border border-destructive/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive">
                Something went wrong
              </h3>
              <p className="text-sm text-destructive/80 mt-1">
                {this.state.error?.message}
              </p>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * Help Tooltip Component
 * Provides contextual help with keyboard accessibility
 */
export interface HelpTooltipProps {
  children: React.ReactNode;
  content: string;
  side?: "top" | "right" | "bottom" | "left";
}

export function HelpTooltip({
  children,
  content,
  side = "top",
}: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Empty State Component
 * Shows when no data is available
 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}

/**
 * Status Badge Component
 * Shows operation status with color coding
 */
export interface StatusBadgeProps {
  status: "active" | "inactive" | "pending" | "error";
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const statusConfig = {
    active: "bg-accent-success/10 text-accent-success border-accent-success/40",
    inactive: "bg-muted text-muted-foreground border-border",
    pending: "bg-accent-danger/10 text-accent-danger border-accent-danger/40",
    error: "bg-destructive/10 text-destructive border-destructive/40",
  };

  return (
    <Badge variant="outline" className={statusConfig[status]}>
      {label}
    </Badge>
  );
}

/**
 * Keyboard Shortcut Helper
 * Displays keyboard shortcut in a styled badge
 */
export interface KeyboardShortcutProps {
  keys: string[];
  label?: string;
}

export function KeyboardShortcut({ keys, label }: KeyboardShortcutProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {keys.map((key, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && (
              <span className="text-xs text-muted-foreground">+</span>
            )}
            <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-muted border border-border rounded">
              {key}
            </kbd>
          </React.Fragment>
        ))}
      </div>
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

/**
 * Confirmation Dialog Component
 * Requires explicit user confirmation before destructive actions
 */
export interface ConfirmationDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDangerous?: boolean;
}

export function ConfirmationDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isDangerous = false,
}: ConfirmationDialogProps) {
  return (
    <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full">
        <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-background rounded transition-colors ${
              isDangerous
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-accent-cyan hover:bg-accent-cyan/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
