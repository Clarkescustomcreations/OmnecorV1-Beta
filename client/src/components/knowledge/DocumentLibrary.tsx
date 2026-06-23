import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../ui/table";
import { Search, FileText, UploadCloud, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface SearchResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export const DocumentLibrary: React.FC = () => {
  const [search, setSearch] = useState("");
  const [previewDoc, setPreviewDoc] = useState<SearchResult | null>(null);

  const docsQuery = trpc.knowledgeBase.ensureProject.useMutation({
    onSuccess: () => toast.success("Knowledge base index refreshed"),
    onError: (err) => toast.error("Indexing failed: " + err.message),
  });
  const searchQuery = trpc.knowledgeBase.search.useQuery(
    { projectId: "default", query: search },
    { enabled: search.length > 2 }
  );

  const results = (searchQuery.data as unknown as SearchResult[] | undefined) ?? [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground">Manage and query your local semantic document library.</p>
        </div>
        <div className="flex gap-3">
           <div className="relative w-72">
             <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
             <Input
               placeholder="Filter documents..."
               className="pl-9 h-10"
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
           </div>
           <Button onClick={() => docsQuery.mutate({ projectId: "default" })} className="shadow-md" disabled={docsQuery.isPending}>
             <UploadCloud className="w-4 h-4 mr-2" />
             {docsQuery.isPending ? "Indexing..." : "Refresh Index"}
           </Button>
        </div>
      </div>

      <Card className="border-none shadow-xl bg-card/50 backdrop-blur">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Search Results
            {searchQuery.isFetching && <span className="text-xs text-muted-foreground ml-2">Searching...</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[400px]">Content Snippet</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((res, i) => (
                <TableRow key={i} className="group transition-colors hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded text-primary">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="font-medium truncate max-w-sm">{res.content}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{(res.score * 100).toFixed(1)}%</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      title="View full content"
                      onClick={() => setPreviewDoc(res)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!results.length && (
                <TableRow>
                  <TableCell colSpan={3} className="py-20 text-center text-muted-foreground italic">
                    {search.length > 2
                      ? searchQuery.isLoading
                        ? "Searching..."
                        : "No results found."
                      : "Type more than 2 characters to search..."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Document Preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => !open && setPreviewDoc(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Document Content
              {previewDoc && (
                <Badge variant="outline" className="ml-2">
                  {(previewDoc.score * 100).toFixed(1)}% match
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
            <pre className="whitespace-pre-wrap break-words text-sm font-mono p-4 bg-muted/30 rounded-lg">
              {previewDoc?.content ?? ""}
            </pre>
          </div>
          {previewDoc?.metadata && Object.keys(previewDoc.metadata).length > 0 && (
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Metadata</p>
              <div className="space-y-1">
                {Object.entries(previewDoc.metadata).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground font-mono">{k}:</span>
                    <span className="font-mono">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (previewDoc) {
                  navigator.clipboard.writeText(previewDoc.content);
                  toast.success("Copied to clipboard");
                }
              }}
            >
              Copy Content
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
