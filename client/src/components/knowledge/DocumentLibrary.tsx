import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../ui/table";
import { Search, FileText, UploadCloud, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";

export const DocumentLibrary: React.FC = () => {
  const [search, setSearch] = useState("");
  
  const docsQuery = trpc.knowledgeBase.ensureProject.useMutation(); // Just using available procedures
  const searchMutation = trpc.knowledgeBase.search.useQuery({ projectId: "default", query: search }, { enabled: search.length > 2 });

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
           <Button onClick={() => docsQuery.mutate({ projectId: "default" })} className="shadow-md">
             <UploadCloud className="w-4 h-4 mr-2" /> Refresh Index
           </Button>
        </div>
      </div>

      <Card className="border-none shadow-xl bg-card/50 backdrop-blur">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" /> Search Results
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
              {searchMutation.data?.map((res: any, i: number) => (
                <TableRow key={i} className="group transition-colors hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded text-blue-600">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="font-medium truncate max-w-sm">{res.content}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{(res.score * 100).toFixed(1)}%</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100"><ExternalLink className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!searchMutation.data?.length && (
                <TableRow>
                  <TableCell colSpan={3} className="py-20 text-center text-muted-foreground italic">
                    Type more than 2 characters to search...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
