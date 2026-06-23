import React, { useState } from "react";
import {
  TreeNode,
  convertNetworkToTreeStructure,
  NeuralNetwork,
} from "@/lib/neuralNodeTree";
import { ChevronRight, ChevronDown, Folder, FolderPlus, File, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NeuralTreeViewProps {
  network: NeuralNetwork;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  /** Lazily fetch + merge a truncated folder's subtree (its absolute path). */
  onRequestExpand?: (path: string) => void;
  readOnly?: boolean;
}

export function NeuralTreeView({
  network,
  onNodeClick,
  onNodeDoubleClick,
  onRequestExpand,
  readOnly = false,
}: NeuralTreeViewProps) {
  const treeStructure = convertNetworkToTreeStructure(network);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(
      network.nodes
        .filter(n => n.type === "project" || n.data.isExpanded !== false)
        .map(n => n.id)
    )
  );

  const toggleExpanded = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const isProject = node.type === "project";
    const isTruncated = !!node.truncated;
    const description = (node.metadata?.description as string) || (node.type === 'folder' ? 'Project directory' : 'Source file');

    return (
      <div key={node.id} className="select-none">
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group",
                  isProject && "bg-primary/5 mb-1"
                )}
                style={{ paddingLeft: `${12 + depth * 12}px` }}
                onClick={() => {
                  onNodeClick?.(node.id);
                  if (hasChildren) toggleExpanded(node.id);
                  else if (isTruncated) onRequestExpand?.(node.path);
                }}
                onDoubleClick={() => onNodeDoubleClick?.(node.id)}
              >
                {hasChildren ? (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      toggleExpanded(node.id);
                    }}
                    className="p-0.5 hover:bg-primary/20 rounded transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                ) : isTruncated ? (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onRequestExpand?.(node.path);
                    }}
                    className="p-0.5 hover:bg-primary/20 rounded transition-colors"
                    title="Load this folder"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-primary" />
                  </button>
                ) : (
                  <div className="w-4" />
                )}

                {isProject ? (
                  <Brain className="w-4 h-4 text-primary fill-accent/10 flex-shrink-0" />
                ) : node.type === "folder" ? (
                  <Folder className="w-4 h-4 text-primary/70 flex-shrink-0 group-hover:text-primary" />
                ) : (
                  <File className="w-4 h-4 text-muted-foreground/70 flex-shrink-0 group-hover:text-foreground" />
                )}

                <span className={cn(
                  "flex-1 truncate text-xs",
                  isProject ? "font-bold text-primary" : "font-medium text-foreground/80 group-hover:text-foreground"
                )}>
                  {node.label}
                </span>

                {isTruncated && node.childCount !== undefined && (
                  <span className="text-[10px] text-primary/70 tabular-nums">+{node.childCount}</span>
                )}
                {hasChildren && isExpanded && (
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {node.children!.length}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[200px] p-3 bg-card/95 border-primary/20 shadow-2xl backdrop-blur-md z-[100]">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{node.type}</p>
                <p className="text-xs leading-relaxed text-foreground/90">{description}</p>
                <p className="text-[9px] text-muted-foreground font-mono truncate">{node.path}</p>
                {isTruncated && (
                  <p className="text-[10px] text-primary mt-1">
                    {node.childCount !== undefined ? `${node.childCount} items — ` : ""}click to load this folder
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {hasChildren && isExpanded && (
          <div className="border-l border-border/50 ml-[18px]">
            {node.children!.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full bg-background/50 p-2 overflow-auto scrollbar-thin">
      {treeStructure.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
          <Brain className="w-8 h-8 opacity-20" />
          <p className="text-sm">Neural Tree Empty</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {treeStructure.map(node => renderTreeNode(node))}
        </div>
      )}
    </div>
  );
}
