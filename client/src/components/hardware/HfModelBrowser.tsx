import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import {
  Search, Download, HardDriveDownload, Loader2, Check, AlertTriangle,
  ChevronLeft, Info,
} from "lucide-react";
import { toast } from "sonner";

function formatBytes(n: number): string {
  if (!n) return "—";
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

interface HfModelBrowserProps {
  /** `gguf` = download one quant into the runtime; `base-model` = whole repo for offline training. */
  mode: "gguf" | "base-model";
  /** Called once when a base-model finishes downloading, with its local path. */
  onModelReady?: (localPath: string) => void;
}

/**
 * Browse Hugging Face and download models into Omnecor's own local runtime.
 * - `gguf`: pick an exact quant → streams into the models dir → auto-indexed,
 *   selectable in chat with no Ollama required.
 * - `base-model`: download a whole repo (config + tokenizer + safetensors) into
 *   the base-models dir for offline/sovereign fine-tuning in the LLM Builder.
 */
export const HfModelBrowser: React.FC<HfModelBrowserProps> = ({ mode, onModelReady }) => {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const search = trpc.modelMarketplace.search.useQuery(
    { query: submitted, source: "huggingface", limit: 15 },
    { enabled: submitted.length > 0 },
  );

  const repoFiles = trpc.modelMarketplace.listRepoFiles.useQuery(
    { repoId: selectedRepo ?? "" },
    { enabled: mode === "gguf" && !!selectedRepo },
  );

  const downloadsQuery = trpc.modelMarketplace.downloads.useQuery(undefined, {
    // Only poll while something is actually downloading; idle otherwise. A newly
    // started download re-enables polling via the mutation's onSuccess refetch.
    refetchInterval: (q) =>
      q.state.data?.downloads.some((d) => d.state === "downloading") ? 1500 : false,
  });
  const downloads = (downloadsQuery.data?.downloads ?? []).filter((d) => d.kind === mode);

  const downloadGguf = trpc.modelMarketplace.downloadModel.useMutation({
    onSuccess: () => { toast.success("Download started"); void downloadsQuery.refetch(); },
    onError: (e) => toast.error("Download failed: " + e.message),
  });
  const downloadBase = trpc.modelMarketplace.downloadBaseModel.useMutation({
    onSuccess: () => { toast.success("Base-model download started"); void downloadsQuery.refetch(); },
    onError: (e) => toast.error("Download failed: " + e.message),
  });

  // Hand a finished base-model's local path back to the parent (LLM Builder), once each.
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== "base-model" || !onModelReady) return;
    for (const d of downloads) {
      if (d.state === "done" && d.destPath && !notifiedRef.current.has(d.id)) {
        notifiedRef.current.add(d.id);
        onModelReady(d.destPath);
        toast.success(`Base model ready for offline training: ${d.filename}`);
      }
    }
  }, [downloads, mode, onModelReady]);

  const runSearch = () => setSubmitted(query.trim());

  return (
    <div className="space-y-3">
      {/* Compatibility guidance — Omnecor isn't in HF's "Use this model" menu. */}
      <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        {mode === "gguf" ? (
          <span>
            Omnecor isn't listed in Hugging Face's "Use this model" menu — choose a{" "}
            <span className="font-medium text-foreground">GGUF</span> model (the same files
            <span className="font-medium text-foreground"> Ollama</span> and llama.cpp use).
            Omnecor runs them on its own local runtime — no Ollama required.
          </span>
        ) : (
          <span>
            Search a <span className="font-medium text-foreground">transformers</span> base model
            (safetensors — e.g. an <span className="font-medium text-foreground">Unsloth</span> 4-bit repo),
            then click <span className="font-medium text-foreground">Download for training</span> to fetch the{" "}
            <span className="font-medium text-foreground">full repository</span> (config + tokenizer + weights)
            to this machine. Training then runs fully offline against the local copy — no network, sovereign-safe.
          </span>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          placeholder={mode === "gguf" ? "Search GGUF models (e.g. llama 3.1 8b gguf)" : "Search base models (e.g. unsloth llama 3 8b)"}
        />
        <Button onClick={runSearch} disabled={!query.trim()}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {/* GGUF quant view for an opened repo */}
      {mode === "gguf" && selectedRepo ? (
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedRepo(null)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> {selectedRepo}
          </Button>
          {repoFiles.isLoading && <p className="text-xs text-muted-foreground">Loading quant files…</p>}
          {repoFiles.isError && (
            <p className="text-xs text-destructive">{repoFiles.error?.message ?? "Couldn't list files."}</p>
          )}
          {repoFiles.data && repoFiles.data.files.length === 0 && (
            <p className="text-xs text-muted-foreground">No .gguf files in this repo — try another.</p>
          )}
          {repoFiles.data?.files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-mono">{f.filename}</p>
                <p className="text-[10px] text-muted-foreground">
                  {f.quant ? <Badge variant="secondary" className="mr-1">{f.quant}</Badge> : null}
                  {formatBytes(f.sizeBytes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={downloadGguf.isPending}
                onClick={() => downloadGguf.mutate({ repoId: selectedRepo, filePath: f.path, sizeBytes: f.sizeBytes })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Download
              </Button>
            </div>
          ))}
        </div>
      ) : (
        // Search results
        <div className="space-y-2">
          {search.isFetching && <p className="text-xs text-muted-foreground">Searching Hugging Face…</p>}
          {search.isError && <p className="text-xs text-destructive">{search.error?.message ?? "Search failed."}</p>}
          {submitted && search.data && search.data.models.length === 0 && !search.isFetching && (
            <p className="text-xs text-muted-foreground">No models found for "{submitted}".</p>
          )}
          {search.data?.models.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.id}</p>
                {typeof m.downloads === "number" && (
                  <p className="text-[10px] text-muted-foreground">{m.downloads.toLocaleString()} downloads</p>
                )}
              </div>
              {mode === "gguf" ? (
                <Button size="sm" variant="outline" onClick={() => setSelectedRepo(m.id)}>
                  View quants
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadBase.isPending}
                  onClick={() => downloadBase.mutate({ repoId: m.id })}
                >
                  <HardDriveDownload className="h-3.5 w-3.5 mr-1" /> Download for training
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active + recent downloads */}
      {downloads.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground">Downloads</p>
          {downloads.map((d) => {
            const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0;
            return (
              <div key={d.id} className="space-y-1 rounded-md border px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {d.state === "downloading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  {d.state === "done" && <Check className="h-3.5 w-3.5 text-accent-success" />}
                  {d.state === "error" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                  <span className="min-w-0 flex-1 truncate font-mono">{d.filename}</span>
                  <span className="text-muted-foreground">
                    {formatBytes(d.receivedBytes)}{d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : ""}
                    {d.totalFiles ? ` · ${d.completedFiles}/${d.totalFiles} files` : ""}
                  </span>
                </div>
                {d.state === "downloading" && <Progress value={pct} className="h-1.5" />}
                {d.state === "error" && <p className="text-[10px] text-destructive">{d.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
