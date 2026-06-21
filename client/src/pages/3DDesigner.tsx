import React, { useState, useEffect, useRef } from "react";
import { OmnecorDashboardLayout } from "@/components/OmnecorDashboardLayout";
import { Box, Code2, Cpu, Globe, Maximize2, ExternalLink, Anchor, Columns, Plus, Trash2, Check, X, Sparkles, MessageSquare, AlertCircle, FileText, CheckCircle, RefreshCw, Folder, Save, Settings, CircuitBoard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Streamdown } from "streamdown";
import { useLocation } from "wouter";
import { diffLines } from "diff";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

import { ThreeViewer } from "@/components/designer/ThreeViewer";
import { EnhancedPCBEditor } from "@/components/pcb/EnhancedPCBEditor";
import { WebPreview } from "@/components/designer/WebPreview";
import { ManufacturingPanel } from "@/components/designer/ManufacturingPanel";
import { FloatingWindow } from "@/components/window-system/FloatingWindow";
import { useDesignerStore } from "@/lib/stores/designerStore";
import { cn } from "@/lib/utils";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

type DesignMode = "3d" | "pcb" | "web" | "code";

export function Designer3D() {
  const [mode, setMode] = useState<DesignMode>("3d");
  const [initialCode, setInitialCode] = useState("");
  const [splitView, setSplitView] = useState(false);
  const [showManufacturing, setShowManufacturing] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const { windowMode, setWindowMode, windowPosition, windowSize } = useDesignerStore();

  const [location, setLocation] = useLocation();
  const isExternalRoute = location === "/3d-designer-external";

  // ── Open-in-app mutations ────────────────────────────────────────────────
  const openInBlenderMutation = trpc.blender.openFile.useMutation({
    onSuccess: (data) => {
      const name = data.file ? data.file.split("/").pop() : null;
      toast.success(name ? `Opened ${name} in Blender` : "Blender launched");
    },
    onError: (err) => toast.error("Failed to launch Blender: " + err.message),
  });

  const openInKicadMutation = trpc.kicad.openProject.useMutation({
    onSuccess: (data) => {
      const name = data.file ? data.file.split("/").pop() : null;
      toast.success(name ? `Opened ${name} in KiCad` : "KiCad launched");
    },
    onError: (err) => toast.error("Failed to launch KiCad: " + err.message),
  });

  const handleOpenInBlender = () => {
    const activeFile = files[activeFileIndex];
    const blendPath =
      activeFile?.path?.toLowerCase().endsWith(".blend") ? activeFile.path : undefined;
    openInBlenderMutation.mutate({ filePath: blendPath });
  };

  const handleOpenInKicad = () => {
    const activeFile = files[activeFileIndex];
    const kicadExts = [".kicad_pro", ".kicad_pcb", ".kicad_sch"];
    const p = activeFile?.path?.toLowerCase() ?? "";
    const kicadPath =
      activeFile?.path && kicadExts.some((ext) => p.endsWith(ext))
        ? activeFile.path
        : undefined;
    openInKicadMutation.mutate({ filePath: kicadPath });
  };

  const handleRedockFromExternal = () => {
    const bc = new BroadcastChannel('omnecor_designer_sync');
    bc.postMessage('redock_request');
    bc.close();
    window.close();
  };

  const [files, setFiles] = useState<{ name: string; content: string; originalContent: string; path?: string }[]>(() => {
    const saved = localStorage.getItem("omnecor:designer_files");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return [
      {
        name: "draft.md",
        content: "# Welcome to Omnecor Designer\n\nYou can edit this markdown file and see live preview on the right.",
        originalContent: "# Welcome to Omnecor Designer\n\nYou can edit this markdown file and see live preview on the right."
      }
    ];
  });

  const [activeFileIndex, setActiveFileIndex] = useState(0);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "omnecor:designer_files" && e.newValue) {
        try {
          setFiles(JSON.parse(e.newValue));
        } catch (err) {
          console.error(err);
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [previewTab, setPreviewTab] = useState<"preview" | "diff">("preview");

  // Selection / Highlight state
  const [selectedText, setSelectedText] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [threeDSelectionName, setThreeDSelectionName] = useState<string | null>(null);

  // Clear 3D selection when mode changes
  useEffect(() => {
    setThreeDSelectionName(null);
  }, [mode]);

  const [mdSearchText, setMdSearchText] = useState("");

  const mdTips = [
    { keywords: ["divide", "divider", "line", "horizontal", "hr", "separator"], syntax: "---", name: "Divider" },
    { keywords: ["line break", "linebreak", "newline", "break", "br"], syntax: "<br />", name: "Line Break" },
    { keywords: ["center", "align center", "middle"], syntax: "<center>text</center>", name: "Center Text" },
    { keywords: ["bold", "strong", "important"], syntax: "**text**", name: "Bold text" },
    { keywords: ["italic", "emphasis", "slope", "slant"], syntax: "*text*", name: "Italic text" },
    { keywords: ["heading 1", "h1", "title", "heading1"], syntax: "# Title", name: "Heading 1" },
    { keywords: ["heading 2", "h2", "subtitle", "heading2"], syntax: "## Subtitle", name: "Heading 2" },
    { keywords: ["heading 3", "h3", "heading3"], syntax: "### Heading", name: "Heading 3" },
    { keywords: ["link", "url", "hyperlink", "href"], syntax: "[text](url)", name: "Link" },
    { keywords: ["image", "picture", "photo", "img"], syntax: "![alt](url)", name: "Image" },
    { keywords: ["code block", "codeblock", "pre", "fenced"], syntax: "```\ncode\n```", name: "Code Block" },
    { keywords: ["inline code", "code inline", "tick", "backtick"], syntax: "`code`", name: "Inline Code" },
    { keywords: ["unordered list", "bullet", "dot", "list"], syntax: "- item", name: "Bullet List" },
    { keywords: ["ordered list", "numbered list", "number", "list"], syntax: "1. item", name: "Numbered List" },
    { keywords: ["blockquote", "quote", "citation", "cite"], syntax: "> text", name: "Blockquote" },
    { keywords: ["table", "grid", "cell"], syntax: "| header | header |\n|---|---|\n| cell | cell |", name: "Table" },
    { keywords: ["strikethrough", "strike", "delete", "del"], syntax: "~~text~~", name: "Strikethrough" },
    { keywords: ["tasklist", "task", "todo", "checkbox"], syntax: "- [ ] task", name: "Task List" },
    { keywords: ["underline", "u"], syntax: "<u>text</u>", name: "Underline" },
    { keywords: ["highlight", "mark"], syntax: "<mark>text</mark>", name: "Highlight" }
  ];

  const getMatchingTip = () => {
    if (!mdSearchText.trim()) return null;
    const query = mdSearchText.toLowerCase().trim();
    return mdTips.find(tip => 
      tip.name.toLowerCase().includes(query) || 
      tip.keywords.some(kw => kw.includes(query) || query.includes(kw))
    );
  };
  const matchingTip = getMatchingTip();

  const handleInsertSyntax = (syntax: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const updatedText = text.substring(0, start) + syntax + text.substring(end);

    updateActiveFileContent(updatedText);

    // Reposition cursor after the inserted text
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + syntax.length;
    }, 0);
  };

  const getDiffStats = () => {
    const activeFile = files[activeFileIndex];
    if (!activeFile) return { additions: 0, deletions: 0 };
    try {
      const changes = diffLines(activeFile.originalContent || "", activeFile.content || "");
      let additions = 0;
      let deletions = 0;
      changes.forEach(c => {
        if (c.added) additions += c.count || 0;
        if (c.removed) deletions += c.count || 0;
      });
      return { additions, deletions };
    } catch (e) {
      return { additions: 0, deletions: 0 };
    }
  };
  const diffStats = getDiffStats();

  // Local Project Workspace Explorer
  interface FileTreeNode {
    name: string;
    path: string;
    relativePath: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
  }

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const { data: projects } = trpc.project.list.useQuery();
  const selectedProject = projects?.find(p => p.id === selectedProjectId);

  const { data: fileTree } = trpc.project.getFileTree.useQuery(
    { projectId: selectedProjectId, rootDir: selectedProject?.rootDir || "" },
    { enabled: !!selectedProjectId && !!selectedProject }
  );

  const readFileMutation = trpc.project.readFile.useMutation();
  const writeFileMutation = trpc.project.writeFile.useMutation();

  const handleOpenLocalFile = async (filePath: string, fileName: string) => {
    try {
      const res = await readFileMutation.mutateAsync({ path: filePath });
      setFiles(prev => {
        const existingIdx = prev.findIndex(f => f.path === filePath);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            content: res.content,
            originalContent: res.content
          };
          setTimeout(() => setActiveFileIndex(existingIdx), 0);
          return updated;
        } else {
          const updated = [...prev, {
            name: fileName,
            content: res.content,
            originalContent: res.content,
            path: filePath
          }];
          setTimeout(() => setActiveFileIndex(updated.length - 1), 0);
          return updated;
        }
      });
      toast.success(`Loaded ${fileName}`);
    } catch (err) {
      toast.error("Failed to load local file: " + (err as Error).message);
    }
  };

  const handleSaveLocalFile = async () => {
    const activeFile = files[activeFileIndex];
    if (!activeFile || !activeFile.path) return;
    try {
      await writeFileMutation.mutateAsync({
        path: activeFile.path,
        content: activeFile.content
      });
      setFiles(prev => {
        const updated = [...prev];
        if (updated[activeFileIndex]) {
          updated[activeFileIndex] = {
            ...updated[activeFileIndex],
            originalContent: updated[activeFileIndex].content
          };
        }
        return updated;
      });
      toast.success("Saved file to local disk!");
    } catch (err) {
      toast.error("Failed to save: " + (err as Error).message);
    }
  };

  const renderFileTreeItems = (nodes: FileTreeNode[], depth = 0) => {
    return nodes.map((node) => {
      if (node.type === "directory") {
        return (
          <div key={node.path} className="space-y-0.5">
            <div 
              className="flex items-center gap-1.5 px-2 py-1 text-slate-300 text-[11px] hover:bg-slate-800/40 rounded cursor-pointer font-sans"
              style={{ paddingLeft: `${depth * 8 + 8}px` }}
            >
              <Folder className="w-3.5 h-3.5 text-accent-danger opacity-80" />
              <span className="font-medium truncate">{node.name}</span>
            </div>
            {node.children && renderFileTreeItems(node.children, depth + 1)}
          </div>
        );
      } else {
        const isActive = files[activeFileIndex]?.path === node.path;
        return (
          <div 
            key={node.path}
            className={cn(
              "flex items-center justify-between group px-2 py-1 rounded cursor-pointer text-[11px] font-sans transition-colors",
              isActive
                ? "bg-accent/20 text-accent font-semibold"
                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            )}
            style={{ paddingLeft: `${depth * 8 + 8}px` }}
            onClick={() => handleOpenLocalFile(node.path, node.name)}
          >
            <div className="flex items-center gap-1.5 truncate">
              <FileText className="w-3.5 h-3.5 opacity-70" />
              <span className="truncate">{node.name}</span>
            </div>
          </div>
        );
      }
    });
  };

  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync scroll between textarea and line numbers
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Keep files state persisted in localStorage
  useEffect(() => {
    localStorage.setItem("omnecor:designer_files", JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    // Check if we came from chat with a specific payload
    const savedMode = localStorage.getItem("omnecor:designer_mode") as DesignMode;
    const savedCode = localStorage.getItem("omnecor:designer_code");
    
    if (savedMode && ["3d", "pcb", "web", "code"].includes(savedMode)) {
      setMode(savedMode);
      localStorage.removeItem("omnecor:designer_mode"); // clear after load
    }
    
    if (savedCode) {
      setInitialCode(savedCode);
      localStorage.removeItem("omnecor:designer_code"); // clear after load
    }
  }, []);

  useEffect(() => {
    if (initialCode) {
      setFiles(prev => {
        let ext = "md";
        if (initialCode.trim().startsWith("<")) {
          ext = "html";
        } else if (initialCode.includes("function") || initialCode.includes("const ") || initialCode.includes("import ")) {
          ext = "js";
        }
        
        const fileName = `ai_design.${ext}`;
        const existingIdx = prev.findIndex(f => f.name === fileName);
        const updated = [...prev];
        
        if (existingIdx !== -1) {
          updated[existingIdx] = {
            name: fileName,
            content: initialCode,
            originalContent: initialCode
          };
          setTimeout(() => setActiveFileIndex(existingIdx), 0);
        } else {
          updated.push({
            name: fileName,
            content: initialCode,
            originalContent: initialCode
          });
          setTimeout(() => setActiveFileIndex(updated.length - 1), 0);
        }
        return updated;
      });
      // Clear initialCode to prevent loop
      setInitialCode("");
    }
  }, [initialCode]);

  // Handle External Window Launching
  useEffect(() => {
    if (windowMode === "external") {
      const win = window.open(
        "/3d-designer-external",
        "Omnecor3DDesigner",
        `width=${windowSize.width},height=${windowSize.height},left=${windowPosition.x},top=${windowPosition.y},menubar=no,toolbar=no,location=no,status=no`
      );

      if (!win) {
        alert("Pop-up blocked! Please allow pop-ups to use the external window mode.");
        setWindowMode("embedded");
      }
      
      const bc = new BroadcastChannel('omnecor_designer_sync');
      bc.onmessage = (event) => {
        if (event.data === 'redock_request') {
          setWindowMode("embedded");
        }
      };
      
      return () => {
        bc.postMessage('redock');
        bc.close();
      };
    }
  }, [windowMode, setWindowMode, windowPosition, windowSize]);

  const updateActiveFileContent = (newVal: string) => {
    setFiles(prev => {
      const updated = [...prev];
      if (updated[activeFileIndex]) {
        updated[activeFileIndex] = {
          ...updated[activeFileIndex],
          content: newVal
        };
      }
      return updated;
    });
  };

  const handleAcceptChanges = () => {
    setFiles(prev => {
      const updated = [...prev];
      if (updated[activeFileIndex]) {
        updated[activeFileIndex] = {
          ...updated[activeFileIndex],
          originalContent: updated[activeFileIndex].content
        };
      }
      return updated;
    });
  };

  const handleRejectChanges = () => {
    if (!confirm("Are you sure you want to discard your edits and revert to the original version?")) return;
    setFiles(prev => {
      const updated = [...prev];
      if (updated[activeFileIndex]) {
        updated[activeFileIndex] = {
          ...updated[activeFileIndex],
          content: updated[activeFileIndex].originalContent
        };
      }
      return updated;
    });
  };

  const handleCreateFile = () => {
    if (!newFileName.trim()) {
      setIsCreatingFile(false);
      return;
    }
    const cleanName = newFileName.trim();
    if (files.some(f => f.name.toLowerCase() === cleanName.toLowerCase())) {
      alert("A file with this name already exists!");
      return;
    }
    const newFile = {
      name: cleanName,
      content: "",
      originalContent: ""
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileIndex(files.length);
    setNewFileName("");
    setIsCreatingFile(false);
    setPreviewTab(cleanName.endsWith(".md") ? "preview" : "diff");
  };

  const handleCloseFile = (indexToRemove: number) => {
    if (files.length <= 1) {
      setFiles([
        {
          name: "draft.md",
          content: "",
          originalContent: ""
        }
      ]);
      setActiveFileIndex(0);
      return;
    }

    const updated = files.filter((_, idx) => idx !== indexToRemove);
    setFiles(updated);

    if (activeFileIndex >= updated.length) {
      setActiveFileIndex(updated.length - 1);
    } else if (activeFileIndex === indexToRemove) {
      setActiveFileIndex(Math.max(0, indexToRemove - 1));
    } else if (activeFileIndex > indexToRemove) {
      setActiveFileIndex(activeFileIndex - 1);
    }
  };

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value.substring(start, end);
    if (text.trim().length > 0) {
      setSelectedText(text);
    }
  };

  const handleSendToAi = (actionType: "suggest" | "fix" | "ask") => {
    const payload = {
      code: selectedText,
      notes: aiInstructions,
      actionType
    };
    localStorage.setItem("omnecor:pending_ai_query", JSON.stringify(payload));
    setSelectedText("");
    setAiInstructions("");
    setLocation("/chat");
  };

  const renderDiff = (original: string, modified: string) => {
    const changes = diffLines(original, modified);
    return (
      <div className="font-mono text-xs leading-6 overflow-auto h-full p-4 bg-slate-950 text-slate-300 select-text">
        {changes.map((change, idx) => {
          const lines = change.value.split("\n");
          if (lines[lines.length - 1] === "") {
            lines.pop();
          }
          return lines.map((line, lineIdx) => {
            let bgClass = "text-muted-foreground border-l-2 border-transparent px-2";
            let prefix = " ";
            if (change.added) {
              bgClass = "bg-accent-success/10 text-accent-success border-l-2 border-accent-success px-2";
              prefix = "+";
            } else if (change.removed) {
              bgClass = "bg-destructive/10 text-destructive border-l-2 border-destructive line-through px-2";
              prefix = "-";
            }
            return (
              <div key={`${idx}-${lineIdx}`} className={cn("flex whitespace-pre-wrap py-0.5", bgClass)}>
                <span className="w-4 select-none opacity-50 mr-2 text-center">{prefix}</span>
                <span className="flex-1">{line}</span>
              </div>
            );
          });
        })}
      </div>
    );
  };

  const activeFileCode = files[activeFileIndex]?.content || "";

  const renderDesignerContent = () => (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {mode === "3d" && (
        <ThreeViewer
          code={activeFileCode}
          onObjectSelect={(name) => setThreeDSelectionName(name || null)}
        />
      )}
      {mode === "pcb" && <EnhancedPCBEditor onAIToggle={setIsAIPanelOpen} />}
      {mode === "web" && (
        <WebPreview
          code={activeFileCode}
          onChange={(newVal) => updateActiveFileContent(newVal)}
          onTextHighlight={(text) => setSelectedText(text)}
        />
      )}
      {mode === "code" && (
        <div className="w-full h-full flex flex-col overflow-hidden bg-slate-950 select-none">
          {/* Virtual File Tabs Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs flex-shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto max-w-[40%] pr-4 no-scrollbar flex-shrink-0">
              {files.map((file, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md border-t-2 transition-all cursor-pointer",
                    activeFileIndex === idx
                      ? "bg-slate-950 border-accent text-slate-100 font-semibold"
                      : "border-transparent text-slate-400 hover:bg-slate-950/50 hover:text-slate-200"
                  )}
                  onClick={() => {
                    setActiveFileIndex(idx);
                    setSelectedText(""); // clear selection when switching
                  }}
                >
                  <FileText className="w-3.5 h-3.5 opacity-70" />
                  <span>{file.name}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:bg-slate-800 rounded-full p-0.5 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseFile(idx);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {isCreatingFile ? (
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-2 py-1">
                  <input
                    type="text"
                    className="bg-transparent text-slate-100 text-xs outline-none w-24 border-none"
                    placeholder="filename.md"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFile();
                      if (e.key === "Escape") setIsCreatingFile(false);
                    }}
                    autoFocus
                  />
                  <button onClick={handleCreateFile} className="text-accent-success hover:text-accent-success/80">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => setIsCreatingFile(false)} className="text-destructive hover:text-destructive/80">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md"
                  onClick={() => setIsCreatingFile(true)}
                  title="Create new file"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {/* Markdown Tips Bar search tool */}
            <div className="flex items-center gap-2 max-w-[45%] flex-1 justify-center px-4">
              <input
                type="text"
                className="bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2.5 py-1 outline-none focus:border-accent w-36 font-sans"
                placeholder="Search markdown... (e.g. divide)"
                value={mdSearchText}
                onChange={(e) => setMdSearchText(e.target.value)}
              />
              
              {matchingTip ? (
                <div
                  className="bg-slate-900 border border-dashed border-accent/40 hover:border-accent hover:text-accent text-slate-305 text-[11px] px-2.5 py-1 rounded cursor-pointer transition-all flex items-center gap-1.5 font-mono select-none"
                  onClick={() => handleInsertSyntax(matchingTip.syntax)}
                  title="Click to insert at cursor"
                >
                  <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                  <span className="opacity-80 text-[10px]">{matchingTip.name}:</span>
                  <span className="font-semibold text-slate-100">{matchingTip.syntax}</span>
                </div>
              ) : mdSearchText.trim() ? (
                <div className="text-slate-500 text-[11px] px-2 py-1 select-none font-sans">
                  No match
                </div>
              ) : (
                <div className="text-slate-500 text-[10px] select-none font-sans italic opacity-70 truncate">
                  💡 Try 'center', 'divide', or 'bold'
                </div>
              )}
            </div>
            
            {/* Right: Diff Meter and File Type Badge */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="flex items-center gap-1.5 font-mono text-[11px] select-none bg-card px-2 py-1 rounded border border-border">
                <span className="text-muted-foreground text-[10px] mr-1 uppercase font-semibold">Changes</span>
                <span className="text-accent-success font-bold">+{diffStats.additions}</span>
                <span className="text-destructive font-bold">-{diffStats.deletions}</span>
              </div>

              <Badge variant="secondary" className="bg-slate-800 text-slate-300 border-none font-mono text-[10px]">
                {files[activeFileIndex]?.name?.endsWith(".md") ? "Markdown" : "Code"} File
              </Badge>
            </div>
          </div>

          {/* Main workspace (Editor & Preview split) */}
          <div className="flex-1 flex overflow-hidden relative">
            
            {/* Left Workspace Panel: Local Project Files Explorer — hidden on mobile */}
            <div className="hidden md:flex w-44 lg:w-56 h-full bg-slate-900 border-r border-slate-800 flex-col flex-shrink-0">
              <div className="p-3 border-b border-slate-800 flex-shrink-0 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Local Workspace</span>
                <span className="text-[9px] text-accent font-semibold bg-accent/10 px-1 rounded">Beta</span>
              </div>

              {/* Project Dropdown Selector */}
              <div className="p-3 border-b border-slate-800 space-y-1.5 flex-shrink-0 font-sans">
                <label className="text-[10px] text-slate-500">Active Project Watcher</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-accent"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  <option value="">-- Select Project --</option>
                  {projects?.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project File Tree List */}
              <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1 select-none font-sans">
                {selectedProjectId ? (
                  fileTree && fileTree.length > 0 ? (
                    renderFileTreeItems(fileTree)
                  ) : (
                    <div className="text-slate-500 text-[10px] p-2 text-center italic">
                      No files found or indexing...
                    </div>
                  )
                ) : (
                  <div className="text-slate-500 text-[10px] p-3 text-center italic leading-relaxed">
                    Select a project watcher from the dropdown above to load local files.
                  </div>
                )}
              </div>
            </div>

            {/* Left pane: Code Editor */}
            <div className={cn(
              "h-full flex flex-col bg-slate-950 transition-all duration-300 relative",
              splitView ? "w-1/2 border-r border-slate-800/60" : "w-full"
            )}>
              <div className="flex-1 flex overflow-hidden relative">
                {/* Line Numbers Sidebar */}
                <div 
                  ref={lineNumbersRef}
                  className="select-none text-right pr-2 pl-4 py-4 text-slate-600 bg-slate-950 border-r border-slate-900 text-[11px] leading-6 font-mono min-w-[3.5rem] overflow-hidden"
                >
                  {(files[activeFileIndex]?.content || "").split("\n").map((_, i) => (
                    <div key={i} className="h-6">{i + 1}</div>
                  ))}
                </div>

                {/* Actual Editor Textarea */}
                <textarea
                  ref={textareaRef}
                  className="flex-1 p-4 bg-transparent text-slate-100 outline-none resize-none border-none leading-6 font-mono text-xs h-full overflow-auto selection:bg-accent/30 selection:text-white"
                  value={files[activeFileIndex]?.content || ""}
                  onChange={(e) => updateActiveFileContent(e.target.value)}
                  onScroll={handleScroll}
                  onSelect={handleTextareaSelect}
                  placeholder="// Start typing here..."
                />
              </div>

            </div>

            {/* Right Pane: Split view (Live Preview OR Diff Checker) */}
            {splitView && (
              <div className="w-1/2 h-full flex flex-col bg-slate-900 border-l border-slate-800 overflow-hidden">
                {/* Header Toggle bar */}
                <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2 flex-shrink-0 text-xs">
                  <div className="flex bg-slate-900 rounded p-0.5">
                    {files[activeFileIndex]?.name?.endsWith(".md") && (
                      <button
                        className={cn(
                          "px-3 py-1 rounded transition-all",
                          previewTab === "preview" 
                            ? "bg-slate-800 text-slate-100 font-semibold" 
                            : "text-slate-400 hover:text-slate-200"
                        )}
                        onClick={() => setPreviewTab("preview")}
                      >
                        Live Preview
                      </button>
                    )}
                    <button
                      className={cn(
                        "px-3 py-1 rounded transition-all",
                        previewTab === "diff" || !files[activeFileIndex]?.name?.endsWith(".md")
                          ? "bg-slate-800 text-slate-100 font-semibold" 
                          : "text-slate-400 hover:text-slate-200"
                      )}
                      onClick={() => setPreviewTab("diff")}
                    >
                      Diff Checker
                    </button>
                  </div>

                  {/* Diff Control Buttons */}
                  {(previewTab === "diff" || !files[activeFileIndex]?.name?.endsWith(".md")) && (
                    <div className="flex items-center gap-1.5">
                      {files[activeFileIndex]?.path && (
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-sky-600 hover:bg-sky-700 text-white h-6 px-2.5 text-[10px]"
                          onClick={handleSaveLocalFile}
                          title="Save changes to local disk"
                        >
                          <Save className="w-3 h-3 mr-1" /> Save
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-6 px-2.5 text-[10px]"
                        onClick={handleAcceptChanges}
                        title="Accept these changes, committing them as the new base"
                      >
                        <Check className="w-3 h-3 mr-1" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="bg-rose-600 hover:bg-rose-700 text-white h-6 px-2.5 text-[10px]"
                        onClick={handleRejectChanges}
                        title="Revert back to the original version"
                      >
                        <X className="w-3 h-3 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-700 hover:bg-slate-800 text-slate-300 h-6 px-2.5 text-[10px]"
                        onClick={() => {
                          setSelectedText(`Diff of ${files[activeFileIndex]?.name || "file"}:\n\n${files[activeFileIndex]?.content || ""}`);
                          setAiInstructions(`Review the differences and improve it.`);
                        }}
                        title="Request AI changes on this file"
                      >
                        <Sparkles className="w-3 h-3 mr-1 text-accent" /> Suggest Changes
                      </Button>
                    </div>
                  )}
                </div>

                {/* Content View */}
                <div className="min-h-0 flex-1 overflow-auto bg-slate-950">
                  {previewTab === "preview" && files[activeFileIndex]?.name?.endsWith(".md") ? (
                    <div className="p-8 text-foreground prose dark:prose-invert max-w-none text-slate-200 selection:bg-accent/30 bg-slate-950 min-h-full">
                      <Streamdown>{files[activeFileIndex]?.content || ""}</Streamdown>
                    </div>
                  ) : (
                    <div className="p-0 h-full">
                      {renderDiff(
                        files[activeFileIndex]?.originalContent || "",
                        files[activeFileIndex]?.content || ""
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating "Ask AI" button for 3D and PCB modes (no text selection in those views) */}
      {(mode === "3d" || mode === "pcb") && !isAIPanelOpen && selectedText.trim().length === 0 && !threeDSelectionName && (
        <button
          className="absolute bottom-5 right-5 flex items-center gap-2 bg-slate-900 border border-accent/40 hover:border-accent text-accent text-[11px] font-semibold px-3 py-2 rounded-xl shadow-xl z-30 transition-all hover:bg-slate-800 font-sans"
          onClick={() => {
            setSelectedText(
              mode === "3d"
                ? "I'm looking at a 3D model in the designer. Please help me with the following:"
                : "I'm working in the PCB/Schematic editor. Please help me with the following:"
            );
            setAiInstructions("");
          }}
        >
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          Ask AI About This View
        </button>
      )}

      {/* AI Selection Helper Popover — shown for all modes when text is selected */}
      {selectedText.trim().length > 0 && (
        <div className="absolute bottom-4 right-4 bg-slate-900 border-2 border-accent/40 rounded-xl shadow-2xl p-4 w-80 z-30 animate-in fade-in slide-in-from-bottom-2 duration-250 select-text">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-accent flex items-center gap-1.5 font-sans">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI Selection Helper
            </span>
            <button
              className="text-slate-400 hover:text-slate-200"
              onClick={() => setSelectedText("")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-slate-950 p-2 rounded text-[10px] font-mono text-slate-300 mb-3 max-h-16 overflow-y-auto whitespace-pre-wrap break-words border border-slate-800">
            {selectedText.length > 100 ? `${selectedText.substring(0, 100)}...` : selectedText}
          </div>

          <textarea
            className="w-full bg-slate-950 text-slate-200 text-xs rounded border border-slate-800 p-2 outline-none focus:border-accent resize-none h-16 mb-3 font-sans"
            placeholder="Describe the needed changes, fix, or ask a question..."
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
          />

          <div className="flex flex-col gap-1.5 font-sans">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                className="flex-1 text-[11px] h-7 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => handleSendToAi("suggest")}
              >
                Suggest Changes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[11px] h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handleSendToAi("fix")}
              >
                Fix Code
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-[11px] h-7 border-slate-700 hover:bg-slate-800 text-slate-300"
              onClick={() => handleSendToAi("ask")}
            >
              Ask AI About This
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (isExternalRoute) {
    return (
      <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100">
        <div className="flex items-center justify-between px-6 py-2 border-b border-slate-800 bg-slate-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Box className="w-5 h-5 text-accent animate-pulse" />
            <span className="font-semibold text-xs tracking-wider uppercase">Omnecor 3D Designer — Detached Window</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-accent/30 hover:bg-accent/10 text-accent font-medium text-xs h-7"
            onClick={handleRedockFromExternal}
          >
            Re-dock to Workspace
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden relative">
          {renderDesignerContent()}
        </div>
      </div>
    );
  }

  return (
    <OmnecorDashboardLayout>
      <div className="h-full flex flex-col bg-background relative overflow-hidden">
        {/* Floating Window Overlay */}
        <FloatingWindow
          title={`3D Designer (${mode.toUpperCase()})`}
          isOpen={windowMode === "floating"}
          onClose={() => setWindowMode("embedded")}
          onDock={() => setWindowMode("embedded")}
          onExternal={() => setWindowMode("external")}
          initialPosition={windowPosition}
          initialSize={windowSize}
        >
          <div className="w-full h-full bg-slate-900">
            {renderDesignerContent()}
          </div>
        </FloatingWindow>

        <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Box className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex flex-wrap items-center gap-2">
                Multi-Modal Designer
                <Badge variant="outline" className="text-[10px] py-0 text-accent border-accent">Beta</Badge>
              </h1>
              <p className="text-sm text-muted-foreground truncate">View and interact with generated models, circuits, and UI.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <div className="flex flex-wrap bg-muted rounded-md p-1 mr-1 sm:mr-4">
              <Button size="sm" variant={mode === "3d" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setMode("3d")}>
                <Box className="w-3.5 h-3.5 mr-1.5" /> 3D View
              </Button>
              <Button size="sm" variant={mode === "pcb" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setMode("pcb")}>
                <Cpu className="w-3.5 h-3.5 mr-1.5" /> Schematic/PCB
              </Button>
              <Button size="sm" variant={mode === "web" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setMode("web")}>
                <Globe className="w-3.5 h-3.5 mr-1.5" /> Web Preview
              </Button>
              <Button size="sm" variant={mode === "code" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setMode("code")}>
                <Code2 className="w-3.5 h-3.5 mr-1.5" /> Code
              </Button>
            </div>

            {/* Open in Blender — visible in 3D mode */}
            {mode === "3d" && (
              <HowToTooltip
                title="Open in Blender"
                description={
                  files[activeFileIndex]?.path?.toLowerCase().endsWith(".blend")
                    ? `Send ${files[activeFileIndex]!.path!.split("/").pop()} to Blender GUI for full editing.`
                    : "Launch Blender GUI. Load a .blend file from the workspace panel first to open it directly."
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs mr-2 border-orange-500/40 text-orange-400 hover:bg-orange-500/10 hover:border-orange-400"
                  onClick={handleOpenInBlender}
                  disabled={openInBlenderMutation.isPending}
                >
                  <Box className="w-3.5 h-3.5 mr-1.5" />
                  {openInBlenderMutation.isPending ? "Opening…" : "Open in Blender"}
                </Button>
              </HowToTooltip>
            )}

            {/* Open in KiCad — visible in PCB mode */}
            {mode === "pcb" && (
              <HowToTooltip
                title="Open in KiCad"
                description={
                  files[activeFileIndex]?.path &&
                  [".kicad_pro", ".kicad_pcb", ".kicad_sch"].some((e) =>
                    files[activeFileIndex]!.path!.toLowerCase().endsWith(e)
                  )
                    ? `Send ${files[activeFileIndex]!.path!.split("/").pop()} to KiCad EDA for full editing.`
                    : "Launch KiCad EDA. Load a .kicad_pro / .kicad_pcb / .kicad_sch file from the workspace panel first to open it directly."
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs mr-2 border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/10 hover:border-accent-cyan"
                  onClick={handleOpenInKicad}
                  disabled={openInKicadMutation.isPending}
                >
                  <CircuitBoard className="w-3.5 h-3.5 mr-1.5" />
                  {openInKicadMutation.isPending ? "Opening…" : "Open in KiCad"}
                </Button>
              </HowToTooltip>
            )}

            {/* Split View Toggle (Only for Code mode) */}
            {mode === "code" && (
              <HowToTooltip title="Split View" description="Enable a side-by-side live Markdown preview of your code.">
                <Button 
                  size="icon" 
                  variant={splitView ? "default" : "outline"} 
                  className="h-8 w-8 mr-2" 
                  onClick={() => setSplitView(!splitView)}
                >
                  <Columns className="w-4 h-4" />
                </Button>
              </HowToTooltip>
            )}

            {/* Manufacturing Sidebar Toggle */}
            <HowToTooltip title="Manufacturing Engine" description="Access remote rendering and PCB manufacturing tools.">
              <Button 
                size="icon" 
                variant={showManufacturing ? "default" : "outline"} 
                className="h-8 w-8 mr-2" 
                onClick={() => setShowManufacturing(!showManufacturing)}
              >
                <Settings className={cn("w-4 h-4", showManufacturing && "animate-spin-slow")} />
              </Button>
            </HowToTooltip>

            {/* Window Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant={windowMode === "floating" ? "default" : "outline"}
                className="h-8 w-8"
                onClick={() => setWindowMode(windowMode === "floating" ? "embedded" : "floating")}
                title="Floating window"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant={windowMode === "external" ? "default" : "outline"}
                className="h-8 w-8"
                onClick={() => setWindowMode("external")}
                title="External window"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 p-3 sm:p-6 overflow-hidden flex gap-3 sm:gap-6">
          <Card className="flex-1 h-full p-0 overflow-hidden border-2 border-border/50 shadow-2xl relative">
            {windowMode === "embedded" ? (
               renderDesignerContent()
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-muted/20 h-full">
                <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center mb-4">
                  <Anchor className="h-6 w-6 text-accent animate-pulse" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Designer Detached</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  The designer workspace is currently active in a {windowMode} window. 
                  Click the dock icon or the button below to bring it back.
                </p>
                <Button 
                  variant="outline" 
                  className="mt-6 border-accent/30 hover:bg-accent/10"
                  onClick={() => setWindowMode("embedded")}
                >
                  Re-dock to Workspace
                </Button>
              </div>
            )}
          </Card>

          {showManufacturing && (
            <div className="h-full animate-in slide-in-from-right duration-300">
              <ManufacturingPanel 
                mode={mode === "pcb" ? "pcb" : "3d"} 
                activeFile={files[activeFileIndex]?.path || null} 
              />
            </div>
          )}
        </div>
      </div>
    </OmnecorDashboardLayout>
  );
}
