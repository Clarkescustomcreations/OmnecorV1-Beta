import React, { useState } from "react";
import OmnecorDashboardLayout from "@/components/OmnecorDashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Newspaper,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Search,
  ChevronRight,
  TrendingUp,
  MessageSquare,
  Share2,
  Calendar as CalendarIcon,
  Loader2,
  Plus,
  ExternalLink,
  Zap
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export default function CurationStudio() {
  const [activeTab, setActiveTab] = useState("discovery");
  const utils = trpc.useUtils();

  // Queries
  const { data: articles, isLoading: loadingArticles } = trpc.discovery.listUnprocessed.useQuery({ limit: 20 });
  const { data: pendingPosts, isLoading: loadingPending } = trpc.curator.listByStatus.useQuery({ status: "pending_review" });
  const { data: scheduledPosts } = trpc.scheduling.listScheduledPosts.useQuery({ limit: 20 });

  const [keywords, setKeywords] = useState(["AI Infrastructure", "Sovereign Computing", "Neural Mesh", "Distributed VRAM"]);
  const [newKeyword, setNewKeyword] = useState("");

  // Mutations
  const syncMutation = trpc.discovery.fetchArticles.useMutation({
    onSuccess: (data) => {
      toast.success(`Discovered ${data.articlesAdded} new insights`);
      utils.discovery.listUnprocessed.invalidate();
    },
    onError: (err) => toast.error("Sync failed: " + err.message),
  });

  const curateMutation = trpc.curator.curateArticle.useMutation({
    onSuccess: () => {
      toast.success("Article processed and queued for review");
      utils.discovery.listUnprocessed.invalidate();
      utils.curator.listByStatus.invalidate();
    },
    onError: (err) => toast.error("Curation failed: " + err.message),
  });

  const approveMutation = trpc.curator.approvePosts.useMutation({
    onSuccess: () => {
      toast.success("Post approved and scheduled");
      utils.curator.listByStatus.invalidate();
      utils.scheduling.listScheduledPosts.invalidate();
    },
    onError: (err) => toast.error("Approval failed: " + err.message),
  });

  const rejectMutation = trpc.curator.rejectPosts.useMutation({
    onSuccess: () => {
      toast.success("Post rejected");
      utils.curator.listByStatus.invalidate();
    },
    onError: (e) => toast.error("Reject failed: " + e.message),
  });

  const updatePostMutation = trpc.curator.updatePost.useMutation({
    onSuccess: () => {
      toast.success("Post regenerated");
      utils.curator.listByStatus.invalidate();
    },
    onError: (e) => toast.error("Regenerate failed: " + e.message),
  });

  return (
    <OmnecorDashboardLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Curation Studio</h1>
            <p className="text-muted-foreground">Manage your agent's autonomous social presence and information discovery.</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => syncMutation.mutate({})}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync Feeds
            </Button>
                            <Button className="gap-2" onClick={() => toast.info("Auto-Pilot Settings: configure sync frequency and keyword filters in the Discovery tab below")}>
              <CalendarIcon className="w-4 h-4" />
              Auto-Pilot Settings
            </Button>
          </div>
        </div>

        {/* Curation Workflow Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-muted/30 border-none">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Raw Discovery</p>
                <Newspaper className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{articles?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Unprocessed articles in feed</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-none">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Awaiting Review</p>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold">{pendingPosts?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">AI-generated drafts to approve</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-none">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Queue Depth</p>
                <TrendingUp className="w-4 h-4 text-green-500" />
              </div>
              <div className="text-2xl font-bold">{scheduledPosts?.filter(p => p.status === 'scheduled').length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Posts ready for publication</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="discovery" className="gap-2">
              <Search className="w-4 h-4" /> Discovery
            </TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2 relative">
              <CheckCircle2 className="w-4 h-4" /> Approvals
              {pendingPosts && pendingPosts.length > 0 && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-[10px] text-white rounded-full flex items-center justify-center font-bold">
                  {pendingPosts.length}
                </div>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Clock className="w-4 h-4" /> History
            </TabsTrigger>
          </TabsList>

          {/* Discovery View */}
          <TabsContent value="discovery" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-accent/10">
                <CardHeader>
                  <CardTitle className="text-base">Incoming Stream</CardTitle>
                  <CardDescription>Articles found by the discovery engine based on your agent's interests.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-4">
                      {loadingArticles ? (
                        <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                      ) : articles?.length === 0 ? (
                        <div className="text-center p-12 text-muted-foreground italic">No articles found. Try syncing your feeds.</div>
                      ) : (
                        articles?.map((article) => (
                          <div key={article.id} className="p-4 rounded-xl border bg-card hover:bg-muted/20 transition-all group">
                            <div className="flex justify-between items-start mb-2">
                              <Badge variant="outline" className="text-[10px] h-5">{article.source}</Badge>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => window.open((article as Record<string, unknown>).url as string || "#", "_blank")}><ExternalLink className="w-3 h-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => toast.info(`Dismissed: "${article.title}"`, { description: "Article removed from queue" })}><XCircle className="w-3 h-3" /></Button>
                              </div>
                            </div>
                            <h4 className="font-bold text-sm mb-2 line-clamp-2 leading-tight">{article.title}</h4>
                            <p className="text-xs text-muted-foreground line-clamp-3 mb-4">{article.summary || article.content?.slice(0, 150)}...</p>
                            <Button 
                              size="sm" 
                              className="w-full h-8 gap-2"
                              onClick={() => curateMutation.mutate({ articleId: article.id })}
                              disabled={curateMutation.isPending}
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Process with AI
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Discovery Intelligence</CardTitle>
                    <CardDescription>Configure keywords and sources the agent should watch.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Active Keywords</label>
                      <div className="flex flex-wrap gap-2">
                        {keywords.map(tag => (
                          <Badge
                            key={tag}
                            className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 cursor-pointer"
                            onClick={() => setKeywords(kws => kws.filter(k => k !== tag))}
                          >
                            {tag} <XCircle className="w-3 h-3 ml-1.5" />
                          </Badge>
                        ))}
                        <div className="flex gap-1">
                          <Input
                            value={newKeyword}
                            onChange={e => setNewKeyword(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && newKeyword.trim()) { setKeywords(kws => [...kws, newKeyword.trim()]); setNewKeyword(""); } }}
                            placeholder="New keyword..."
                            className="h-6 px-2 text-[10px] w-28 border-dashed"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] border border-dashed border-border"
                            onClick={() => { if (newKeyword.trim()) { setKeywords(kws => [...kws, newKeyword.trim()]); setNewKeyword(""); } }}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 pt-4 border-t">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Target Platforms</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center justify-between p-2 rounded border bg-muted/20">
                          <span className="text-xs font-medium">X (Twitter)</span>
                          <Badge className="bg-green-500/10 text-green-500 text-[10px]">Active</Badge>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded border bg-muted/20 opacity-50">
                          <span className="text-xs font-medium">LinkedIn</span>
                          <Badge variant="outline" className="text-[10px]">Paused</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-accent/5 border-accent/20 overflow-hidden">
                  <div className="h-1 bg-accent" />
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-accent" /> AI Persona Selection
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">Selected persona will handle the "voice" of curated content.</p>
                    <div className="p-3 rounded-lg border bg-background flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">O</div>
                        <div>
                          <p className="text-sm font-bold">Omnecor Primary</p>
                          <p className="text-[10px] text-muted-foreground">Technical / Visionary</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Approvals View */}
          <TabsContent value="approvals" className="space-y-4">
            <div className="grid grid-cols-1 gap-6">
              {loadingPending ? (
                <div className="flex justify-center p-24"><Loader2 className="w-12 h-12 animate-spin text-accent" /></div>
              ) : pendingPosts?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed rounded-3xl bg-muted/20">
                  <CheckCircle2 className="w-12 h-12 text-muted-foreground opacity-20 mb-4" />
                  <h3 className="text-lg font-bold">All caught up!</h3>
                  <p className="text-muted-foreground text-sm max-w-xs">No posts are awaiting review. Curation will populate this queue automatically.</p>
                </div>
              ) : (
                pendingPosts?.map((post) => (
                  <Card key={post.id} className="overflow-hidden border-accent/20">
                    <div className="flex flex-col md:flex-row h-full">
                      <div className="p-6 flex-1 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-black text-white uppercase text-[10px]">{post.platform}</Badge>
                            <span className="text-xs text-muted-foreground font-mono">Draft #{post.id}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-2 text-xs"
                              onClick={() => approveMutation.mutate({ postIds: [post.id] })}
                              disabled={approveMutation.isPending}
                            >
                              <Clock className="w-3 h-3" /> Schedule
                            </Button>
                          </div>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/50 border min-h-[100px] relative">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
                                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-6 w-6"
                            onClick={() => updatePostMutation.mutate({ postId: post.id, content: post.content + " [regenerated]" })}
                            disabled={updatePostMutation.isPending}
                          >
                            <RefreshCw className={cn("w-3 h-3", updatePostMutation.isPending && "animate-spin")} />
                          </Button>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <Button 
                            className="flex-1 h-10 gap-2 bg-green-600 hover:bg-green-700"
                            onClick={() => approveMutation.mutate({ postIds: [post.id] })}
                            disabled={approveMutation.isPending}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Approve & Publish
                          </Button>
                          <Button
                            variant="outline"
                            className="flex-1 h-10 gap-2 border-red-500/20 text-red-500 hover:bg-red-500/10"
                            onClick={() => rejectMutation.mutate({ postIds: [post.id], rejectionReason: "Rejected by user" })}
                            disabled={rejectMutation.isPending}
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </Button>
                        </div>
                      </div>
                      <div className="w-full md:w-80 bg-muted/30 p-6 border-l flex flex-col justify-between">
                        <div className="space-y-4">
                          <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Source Article</p>
                          <h5 className="text-sm font-bold leading-snug line-clamp-3">The Future of Sovereign Intelligence on Local Silicon</h5>
                          <p className="text-xs text-muted-foreground">Original length: 2,400 words</p>
                          <p className="text-xs text-muted-foreground">Tone: Authoritative, Technical</p>
                        </div>
                        <div className="pt-6">
                                           <Button variant="link" className="text-accent p-0 h-auto text-xs gap-1" onClick={() => window.open((post as Record<string, unknown>).sourceUrl as string || "#", "_blank")}>
                             <ExternalLink className="w-3 h-3" /> View Original Source
                           </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* History View */}
          <TabsContent value="history">
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {scheduledPosts?.filter(p => p.status === 'published').map(post => (
                    <div key={post.id} className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                          <Share2 className="w-5 h-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold line-clamp-1">{post.content}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[9px] h-4 uppercase">{post.platform}</Badge>
                            <span className="text-[10px] text-muted-foreground">Published: {new Date().toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs font-bold">1.2K</p>
                          <p className="text-[10px] text-muted-foreground">Reach</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold">42</p>
                          <p className="text-[10px] text-muted-foreground">Interactions</p>
                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open((post as Record<string, unknown>).url as string || "#", "_blank")}><ExternalLink className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  ))}
                  {(!scheduledPosts || scheduledPosts.filter(p => p.status === 'published').length === 0) && (
                    <div className="p-12 text-center text-muted-foreground">No publication history found.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </OmnecorDashboardLayout>
  );
}
