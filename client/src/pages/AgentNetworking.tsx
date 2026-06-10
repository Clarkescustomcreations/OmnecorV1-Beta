import { useState, useRef, useCallback } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Zap,
  TrendingUp,
  Share2,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  UserCircle2,
  Upload,
  Image,
  Video,
  Music,
  Trash2,
  Newspaper,
  Clock,
  Search,
  ChevronRight,
  MessageSquare,
  ExternalLink,
  Server,
  Shield,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import PersonaCreationPanel from "@/components/settings/PersonaCreationPanel";
import { useNeuralMap } from "@/contexts/NeuralMapContext";
import { Brain } from "lucide-react";

const PERSONA_STORE_KEY = "omnecor_personas";

function loadPersonaList(): Array<{ id: string; name: string; type: string; avatarDataUrl: string | null }> {
  try { return JSON.parse(localStorage.getItem(PERSONA_STORE_KEY) ?? "[]"); }
  catch { return []; }
}

type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  dataUrl: string;
  size: number;
};

function MediaUploadTab() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const kind: MediaItem["type"] = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
        ? "video"
        : "audio";
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target?.result as string;
        setMedia(prev => [...prev, {
          id: crypto.randomUUID(),
          name: file.name,
          type: kind,
          dataUrl,
          size: file.size,
        }]);
      };
      reader.readAsDataURL(file);
    });
    toast.success(`${files.length} file(s) added`);
  }, []);

  const remove = (id: string) => setMedia(prev => prev.filter(m => m.id !== id));

  const typeIcon = (t: MediaItem["type"]) =>
    t === "image" ? <Image className="w-4 h-4" />
    : t === "video" ? <Video className="w-4 h-4" />
    : <Music className="w-4 h-4" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Media Library</CardTitle>
        <CardDescription>Upload photos, videos, and audio for agent networking content.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary hover:bg-primary/5 cursor-pointer transition-colors p-8"
        >
          <Upload className="w-10 h-10 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">Click or drag to upload</p>
            <p className="text-xs text-muted-foreground mt-0.5">Images (JPG, PNG, WEBP) · Videos (MP4, MOV) · Audio (MP3, WAV)</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="sr-only"
            onChange={e => handleFiles(e.target.files)}
            aria-label="Upload media files"
          />
        </div>

        {/* Media grid */}
        {media.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {media.map(item => (
              <div key={item.id} className="group relative rounded-lg overflow-hidden border bg-muted/20">
                <div className="aspect-square flex items-center justify-center bg-muted/40 overflow-hidden">
                  {item.type === "image" ? (
                    <img src={item.dataUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : item.type === "video" ? (
                    <video src={item.dataUrl} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-10 h-10 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    {typeIcon(item.type)}
                    <span className="text-[10px] truncate">{item.name}</span>
                  </div>
                </div>
                <button
                  onClick={() => remove(item.id)}
                  className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground"
                  aria-label="Remove media"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AgentNetworking() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "calendar");
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newPostForm, setNewPostForm] = useState({ platformAccountId: "", content: "", scheduledAt: "" });
  const [editPostId, setEditPostId] = useState<number | null>(null);
  const [editScheduledAt, setEditScheduledAt] = useState("");
  const personas = loadPersonaList();

  // Neural map link — when on, content discovery and curation context is scoped to active map
  const { activeMap } = useNeuralMap();
  const [linkedToMap, setLinkedToMap] = useState<boolean>(() => {
    try { return localStorage.getItem("omnecor:agent_net_linked_to_map") === "true"; } catch { return false; }
  });
  const handleLinkToggle = (v: boolean) => {
    setLinkedToMap(v);
    localStorage.setItem("omnecor:agent_net_linked_to_map", String(v));
    if (v && activeMap) toast.success(`Agent Networking linked to "${activeMap.name}"`);
    else toast.info("Agent Networking unlinked — working independently");
  };

  // Queries
  const { data: scheduledPostsData, isLoading: isLoadingScheduled, refetch: refetchScheduled } = trpc.scheduling.listScheduledPosts.useQuery({ limit: 50 });
  const { data: accountsData, isLoading: isLoadingAccounts, refetch: refetchAccounts } = trpc.platforms.listAccounts.useQuery();
  const { data: unprocessedArticles, isLoading: isLoadingDiscovery, refetch: refetchDiscovery } = trpc.discovery.listUnprocessed.useQuery({ limit: 10 });
  const { data: analyticsSummary, isLoading: isLoadingAnalytics } = trpc.analytics.getPlatformSummary.useQuery();
  const { data: pendingPosts, isLoading: isLoadingPending, refetch: refetchPending } = trpc.curator.listByStatus.useQuery({ status: "pending_review" });

  const curateArticleMutation = trpc.curator.curateArticle.useMutation({
    onSuccess: () => {
      toast.success("Article curated successfully");
      refetchDiscovery();
      refetchPending();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  const disconnectAccountMutation = trpc.platforms.disconnectAccount.useMutation({
    onSuccess: () => {
      toast.success("Platform disconnected successfully");
      refetchAccounts();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  const createDirectPostMutation = trpc.scheduling.createDirectPost.useMutation({
    onSuccess: () => { setNewPostOpen(false); setNewPostForm({ platformAccountId: "", content: "", scheduledAt: "" }); refetchScheduled(); toast.success("Post scheduled"); },
    onError: (e) => toast.error("Failed to schedule: " + e.message),
  });
  const reschedulePostMutation = trpc.scheduling.reschedulePost.useMutation({
    onSuccess: () => { setEditPostId(null); refetchScheduled(); toast.success("Post rescheduled"); },
    onError: (e) => toast.error("Reschedule failed: " + e.message),
  });
  const cancelPostMutation = trpc.scheduling.cancelPost.useMutation({
    onSuccess: () => {
      toast.success("Post cancelled");
      refetchScheduled();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  // Mutations
  const approveMutation = trpc.curator.approvePosts.useMutation({
    onSuccess: () => {
      toast.success("Post approved");
      refetchPending();
      refetchScheduled();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  const rejectMutation = trpc.curator.rejectPosts.useMutation({
    onSuccess: () => {
      toast.success("Post rejected");
      refetchPending();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  const fetchDiscoveryMutation = trpc.discovery.fetchArticles.useMutation({
    onSuccess: (data) => {
      toast.success(`Found ${data.articlesAdded} articles`);
      refetchDiscovery();
    },
    onError: (error) => toast.error(`Error: ${error.message}`),
  });

  // Derived data
  const scheduledCount = scheduledPostsData?.filter(p => p.status === "scheduled").length || 0;
  const publishedCount = scheduledPostsData?.filter(p => p.status === "published").length || 0;
  const totalEngagement = analyticsSummary?.reduce((acc, curr) =>
    acc + (curr.totalLikes || 0) + (curr.totalShares || 0) + (curr.totalComments || 0), 0) || 0;

  return (
    <OmnecorDashboardLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-start flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Agent Networking</h1>
            <p className="text-muted-foreground">
              Automating agent discourse across {accountsData?.length || 0} platforms.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Link To Neural Map toggle */}
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors",
              linkedToMap
                ? "bg-accent/10 border-accent/40 text-accent"
                : "border-border text-muted-foreground"
            )}>
              <Brain className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs font-medium whitespace-nowrap">
                {linkedToMap && activeMap ? activeMap.name : "Link To Neural Map"}
              </span>
              <Switch
                checked={linkedToMap}
                onCheckedChange={handleLinkToggle}
                className="scale-75"
                aria-label="Link Agent Networking to active neural map"
              />
            </div>

            {/* Agent / Persona selector */}
            <div className="flex items-center gap-2">
              <UserCircle2 className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue placeholder="Select persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none_persona">No persona</SelectItem>
                  {personas.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.avatarDataUrl ? (
                        <img src={p.avatarDataUrl} alt="" className="inline-block w-4 h-4 rounded-full object-cover mr-1.5" />
                      ) : null}
                      {p.name}
                    </SelectItem>
                  ))}
                  {personas.length === 0 && (
                    <SelectItem value="__placeholder" disabled>No personas created yet</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => fetchDiscoveryMutation.mutate({})}
              disabled={fetchDiscoveryMutation.isPending}
              className="gap-2"
            >
              {fetchDiscoveryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync Content
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Scheduled</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{scheduledCount}</div>
              <p className="text-xs text-muted-foreground">Posts in queue</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Published</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{publishedCount}</div>
              <p className="text-xs text-muted-foreground">Total posts sent</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Engagement</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalEngagement > 1000 ? `${(totalEngagement/1000).toFixed(1)}K` : totalEngagement}
              </div>
              <p className="text-xs text-muted-foreground">Interactions</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Platforms</CardTitle>
              <Share2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{accountsData?.length || 0}/8</div>
              <p className="text-xs text-muted-foreground">Connected accounts</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="approvals" className="relative">
              Approvals
              {pendingPosts && pendingPosts.length > 0 && (
                <Badge variant="destructive" className="ml-2 px-1.5 py-0.5 text-[10px]">
                  {pendingPosts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="platforms">Platforms</TabsTrigger>
            <TabsTrigger value="discovery">Discovery</TabsTrigger>
            <TabsTrigger value="media" className="gap-2">
              <Upload className="w-4 h-4" />
              Media
            </TabsTrigger>
            <TabsTrigger value="personas" className="gap-2">
              <UserCircle2 className="w-4 h-4" />
              Personas
            </TabsTrigger>
            <TabsTrigger value="federation" className="gap-2">
              <Share2 className="w-4 h-4" />
              Federation
            </TabsTrigger>
            <TabsTrigger value="curation" className="gap-2">
              <Newspaper className="w-4 h-4" />
              Curation
            </TabsTrigger>
          </TabsList>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Post Calendar</CardTitle>
                  <CardDescription>Upcoming scheduled social media posts.</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setNewPostOpen(v => !v)}>
                  <Plus className="h-4 w-4" /> New Post
                </Button>
              </CardHeader>
              {newPostOpen && (
                <div className="px-6 pb-4 space-y-3 border-t pt-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Platform Account</label>
                    <select
                      className="w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                      value={newPostForm.platformAccountId}
                      onChange={e => setNewPostForm(f => ({ ...f, platformAccountId: e.target.value }))}
                    >
                      <option value="">Select account…</option>
                      {accountsData?.map((a) => (
                        <option key={a.id} value={a.id}>{a.platform} — {a.accountName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Content</label>
                    <textarea
                      className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[80px] resize-none"
                      placeholder="What do you want to post?"
                      value={newPostForm.content}
                      onChange={e => setNewPostForm(f => ({ ...f, content: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Schedule Time</label>
                    <input
                      type="datetime-local"
                      className="w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                      value={newPostForm.scheduledAt}
                      onChange={e => setNewPostForm(f => ({ ...f, scheduledAt: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setNewPostOpen(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={!newPostForm.platformAccountId || !newPostForm.content || !newPostForm.scheduledAt || createDirectPostMutation.isPending}
                      onClick={() => createDirectPostMutation.mutate({
                        platformAccountId: parseInt(newPostForm.platformAccountId),
                        content: newPostForm.content,
                        scheduledAt: new Date(newPostForm.scheduledAt),
                      })}
                    >
                      {createDirectPostMutation.isPending ? "Scheduling…" : "Schedule Post"}
                    </Button>
                  </div>
                </div>
              )}
              <CardContent>
                <div className="space-y-4">
                  {isLoadingScheduled ? (
                    <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                  ) : scheduledPostsData?.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No posts scheduled yet. Curate content to begin.</p>
                  ) : (
                    scheduledPostsData?.map((post) => (
                      <div key={post.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={post.status === "published" ? "secondary" : "default"}>
                              {post.status?.toUpperCase() || 'UNKNOWN'}
                            </Badge>
                            <span className="text-sm font-medium">Post #{post.id}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {post.scheduledAt ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()}` : 'Not scheduled'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {editPostId === post.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="datetime-local"
                                className="text-xs border rounded px-1.5 py-1 bg-background"
                                value={editScheduledAt}
                                onChange={e => setEditScheduledAt(e.target.value)}
                              />
                              <Button
                                size="sm"
                                disabled={!editScheduledAt || reschedulePostMutation.isPending}
                                onClick={() => reschedulePostMutation.mutate({ scheduledPostId: post.id, newScheduledAt: new Date(editScheduledAt) })}
                              >
                                Save
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditPostId(null)}>✕</Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEditPostId(post.id); setEditScheduledAt(post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : ""); }}
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => toast.info("Publish Now: feature pending backend implementation (trpc.scheduling.publishNow)")}
                          >
                            Publish Now
                          </Button>
                          {post.status === "scheduled" && (
                            <Button 
                              variant="destructive" 
                              size="sm"
                              onClick={() => cancelPostMutation.mutate({ scheduledPostId: post.id })}
                              disabled={cancelPostMutation.isPending}
                            >
                              {cancelPostMutation.isPending ? "Cancelling..." : "Cancel"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Approvals Tab */}
          <TabsContent value="approvals" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Approval Queue</CardTitle>
                <CardDescription>Review and approve AI-generated content before it goes live.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {isLoadingPending ? (
                    <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                  ) : pendingPosts?.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No posts pending review. Curate some articles first.</p>
                  ) : (
                    pendingPosts?.map((post) => (
                      <Card key={post.id} className="bg-muted/30 border-border">
                        <CardContent className="pt-6">
                          <div className="flex justify-between items-start mb-4">
                            <Badge variant="outline" className="uppercase">{post.platform}</Badge>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => rejectMutation.mutate({ postIds: [post.id], rejectionReason: "Manual rejection" })}
                                disabled={rejectMutation.isPending}
                                className="text-destructive hover:text-destructive"
                              >
                                <XCircle className="w-4 h-4 mr-2" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => approveMutation.mutate({ postIds: [post.id] })}
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                              </Button>
                            </div>
                          </div>
                          <p className="text-sm leading-relaxed text-foreground">{post.content}</p>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Platform Performance</CardTitle>
                <CardDescription>Engagement metrics across all connected social channels.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {isLoadingAnalytics ? (
                    <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                  ) : analyticsSummary?.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No analytics data available yet.</p>
                  ) : (
                    analyticsSummary?.map((platform) => (
                      <div key={platform.platform} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium uppercase">{platform.platform}</span>
                          <span className="text-muted-foreground">
                            {platform.totalImpressions} impressions • {platform.totalLikes} likes
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${Math.min(100, (platform.totalImpressions || 0) / 100)}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Platforms Tab */}
          <TabsContent value="platforms" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Connected Platforms</CardTitle>
                <CardDescription>Connect your social media accounts via OAuth for instant setup.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Connected Accounts */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">Connected Accounts</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {isLoadingAccounts ? (
                      <div className="col-span-2 flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                    ) : accountsData?.length === 0 ? (
                      <p className="col-span-2 text-center py-8 text-muted-foreground text-sm">No platforms connected yet. Connect one below to get started.</p>
                    ) : (
                      accountsData?.map((account) => (
                        <div key={account.id} className="p-4 border rounded-lg flex items-center justify-between hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className={`w-2 h-2 rounded-full ${account.isActive ? 'bg-green-500' : 'bg-destructive'}`} />
                            <div>
                              <p className="font-medium uppercase">{account.platform}</p>
                              <p className="text-xs text-muted-foreground">{account.accountName || 'Active Account'}</p>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => disconnectAccountMutation.mutate({ accountId: account.id })}
                            disabled={disconnectAccountMutation.isPending}
                          >
                            {disconnectAccountMutation.isPending ? "Disconnecting..." : "Disconnect"}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* OAuth Connect Buttons */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">Add More Platforms</p>
                  <PlatformOAuthButtons accountsData={accountsData} refetch={refetchScheduled} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Discovery Tab */}
          <TabsContent value="discovery" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Content Discovery</CardTitle>
                  <CardDescription>Find and curate new articles for social sharing.</CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => fetchDiscoveryMutation.mutate({})}
                  disabled={fetchDiscoveryMutation.isPending}
                  className="gap-2"
                >
                  {fetchDiscoveryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoadingDiscovery ? (
                    <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
                  ) : unprocessedArticles?.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No new articles found. Click Refresh to sync feeds.</p>
                  ) : (
                    unprocessedArticles?.map((article) => (
                      <div key={article.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-medium line-clamp-2">{article.title || 'Untitled'}</h4>
                            <p className="text-xs text-muted-foreground">{article.source}</p>
                          </div>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => curateArticleMutation.mutate({ articleId: article.id })}
                            disabled={curateArticleMutation.isPending}
                          >
                            {curateArticleMutation.isPending ? "Curating..." : "Curate"}
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{article.summary || article.content?.slice(0, 100)}</p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Media Tab */}
          <TabsContent value="media" className="space-y-4">
            <MediaUploadTab />
          </TabsContent>

          {/* Personas Tab */}
          <TabsContent value="personas" className="space-y-4">
            <PersonaCreationPanel />
          </TabsContent>

          {/* Federation Tab */}
          <TabsContent value="federation" className="space-y-4">
            <MeshFederationPanel />
          </TabsContent>

          {/* Curation Tab */}
          <TabsContent value="curation" className="space-y-4">
            <CurationPanel />
          </TabsContent>
        </Tabs>
      </div>
    </OmnecorDashboardLayout>
  );
}

interface MeshPeer {
  id: string;
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  isApproved?: boolean;
}

function MeshFederationPanel() {
  const utils = trpc.useUtils();
  const { data: identity } = trpc.ommesh.getIdentity.useQuery();
  const { data: peersRaw, isLoading: loadingPeers } = trpc.ommesh.discover.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const peers = peersRaw as unknown as MeshPeer[] | undefined;

  const approveMutation = trpc.ommesh.approvePeer.useMutation({
    onSuccess: () => {
      toast.success("Mesh connection established");
      utils.ommesh.discover.invalidate();
    },
  });

  // Simple SVG Mesh Visualization
  const renderMeshGraph = () => {
    const nodes = [
      { id: "local", name: identity?.hostname || "Local Node", type: "local", isApproved: true as boolean, x: 150, y: 150 },
      ...(peers?.map((p, i) => {
        const angle = (i / (peers.length || 1)) * Math.PI * 2;
        return {
          id: p.id,
          name: p.name,
          type: "peer",
          isApproved: p.isApproved,
          x: 150 + Math.cos(angle) * 100,
          y: 150 + Math.sin(angle) * 100
        };
      }) || [])
    ];

    return (
      <div className="relative w-full aspect-square max-w-[300px] mx-auto bg-muted/10 rounded-full border border-dashed border-accent/20 flex items-center justify-center overflow-hidden">
        <svg viewBox="0 0 300 300" className="w-full h-full">
          {/* Lines */}
          {nodes.filter(n => n.type === "peer").map(node => (
            <line
              key={`line-${node.id}`}
              x1="150" y1="150"
              x2={node.x} y2={node.y}
              stroke="currentColor"
              strokeWidth={node.isApproved ? "2" : "1"}
              className={cn(node.isApproved ? "text-accent" : "text-muted-foreground/30", !node.isApproved && "stroke-dasharray-4")}
              strokeDasharray={node.isApproved ? "0" : "4"}
            />
          ))}
          {/* Central Node */}
          <circle cx="150" cy="150" r="12" className="fill-accent animate-pulse" />
          <circle cx="150" cy="150" r="20" className="fill-accent/20" />
          
          {/* Peer Nodes */}
          {nodes.filter(n => n.type === "peer").map(node => (
            <g key={`node-${node.id}`}>
              <circle 
                cx={node.x} cy={node.y} r="8" 
                className={cn(node.isApproved ? "fill-blue-500" : "fill-muted-foreground/40")} 
              />
              <circle 
                cx={node.x} cy={node.y} r="14" 
                className={cn(node.isApproved ? "fill-blue-500/20" : "fill-transparent")} 
              />
            </g>
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-[10px] font-bold uppercase tracking-tighter text-accent bg-background/80 px-2 py-0.5 rounded border border-accent/20">
            Active Mesh
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Federated Networking</CardTitle>
              <CardDescription>Manage how your agents interact with other OMMESH nodes.</CardDescription>
            </div>
            {loadingPeers && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Cross-Node Sync</Label>
                  <p className="text-[10px] text-muted-foreground">Sync persona knowledge and analytics.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Agent Discourse</Label>
                  <p className="text-[10px] text-muted-foreground">Allow agents to initiate peer-to-peer chat.</p>
                </div>
                <Switch defaultChecked />
              </div>
              
              <div className="pt-4 border-t space-y-3">
                <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Discovered Peers</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {(!peers || peers.length === 0) ? (
                    <p className="text-xs italic text-muted-foreground py-4">No peers detected on local network...</p>
                  ) : (
                    peers.map((peer) => (
                      <div key={peer.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                        <div className="flex items-center gap-3 min-w-0">
                          <Server className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{peer.name}</p>
                            <p className="text-[10px] font-mono opacity-50 truncate">{peer.address}</p>
                          </div>
                        </div>
                        {!peer.isApproved ? (
                          <Button size="sm" className="h-7 text-[10px]" onClick={() => approveMutation.mutate({ fingerprint: peer.fingerprint })}>
                            Authorize
                          </Button>
                        ) : (
                          <Badge variant="secondary" className="bg-green-500/10 text-green-500 h-5 text-[10px]">Connected</Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-center justify-center p-4 border rounded-xl bg-muted/10">
              <p className="text-xs font-bold uppercase text-muted-foreground mb-4">Topology Visualization</p>
              {renderMeshGraph()}
              <div className="mt-4 flex gap-4 text-[10px]">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-accent" /> Local</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500" /> Linked</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Pending</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Shield className="w-4 h-4 text-accent" /> Node Identity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Current Node</p>
              <p className="font-mono text-xs">{identity?.hostname || "..."}</p>
            </div>
            <div className="space-y-1 pt-2 border-t">
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Fingerprint</p>
              <p className="font-mono text-[9px] break-all opacity-70 leading-tight">{identity?.fingerprint || "..."}</p>
            </div>
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                            <Button variant="outline" size="sm" className="w-full mt-2 text-[10px] h-8 gap-2">
              <Share2 className="w-3 h-3" /> Export Identity
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-accent/5 border-accent/20">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-accent">
              <Zap className="w-4 h-4" /> Mesh Strength
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(peers?.filter((p) => p.isApproved).length || 0) + 1} Nodes</div>
            <p className="text-xs text-muted-foreground">Active in distributed cloud</p>
            <div className="mt-4 h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: '45%' }} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const OAUTH_PLATFORMS = [
  { id: "twitter", label: "X (Twitter)", icon: "𝕏", color: "bg-black hover:bg-gray-800" },
  { id: "linkedin", label: "LinkedIn", icon: "in", color: "bg-blue-600 hover:bg-blue-700" },
  { id: "instagram", label: "Instagram", icon: "📷", color: "bg-pink-600 hover:bg-pink-700" },
  { id: "tiktok", label: "TikTok", icon: "♪", color: "bg-black hover:bg-gray-800" },
  { id: "facebook", label: "Facebook", icon: "f", color: "bg-blue-600 hover:bg-blue-700" },
  { id: "youtube", label: "YouTube", icon: "▶", color: "bg-red-600 hover:bg-red-700" },
];

function PlatformOAuthButtons({
  accountsData,
  refetch,
}: {
  accountsData: { platform: string; [key: string]: unknown }[] | undefined;
  refetch: () => void;
}) {
  const getAuthUrlMutation = trpc.oauth.getAuthorizationUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => toast.error(`OAuth failed: ${error.message}`),
  });

  const connectedPlatforms = new Set(
    accountsData?.map((a) => a.platform?.toLowerCase() ?? "") || []
  );

  const handleConnect = (platform: string) => {
    getAuthUrlMutation.mutate({ platform: platform as Parameters<typeof getAuthUrlMutation.mutate>[0]["platform"] });
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {OAUTH_PLATFORMS.map((platform) => (
        <button
          key={platform.id}
          onClick={() => handleConnect(platform.id)}
          disabled={getAuthUrlMutation.isPending || connectedPlatforms.has(platform.id)}
          className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
            connectedPlatforms.has(platform.id)
              ? "border-green-500/30 bg-green-500/5 cursor-not-allowed opacity-60"
              : `border-border ${platform.color} text-white font-medium`
          }`}
        >
          <span className="text-lg">{platform.icon}</span>
          <span className="text-xs text-center">{platform.label}</span>
          {connectedPlatforms.has(platform.id) && (
            <Badge variant="secondary" className="text-[10px] mt-1">
              ✓ Connected
            </Badge>
          )}
          {getAuthUrlMutation.isPending && (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
        </button>
      ))}
    </div>
  );
}

function CurationPanel() {
  const [curationTab, setCurationTab] = useState("discovery");
  const utils = trpc.useUtils();

  const { data: articles, isLoading: loadingArticles } = trpc.discovery.listUnprocessed.useQuery({ limit: 20 });
  const { data: pendingPosts, isLoading: loadingPending } = trpc.curator.listByStatus.useQuery({ status: "pending_review" });
  const { data: scheduledPosts } = trpc.scheduling.listScheduledPosts.useQuery({ limit: 20 });

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

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Curation Studio</h2>
          <p className="text-muted-foreground text-sm">Manage your agent's autonomous social presence and information discovery.</p>
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
          <Button className="gap-2">
            <Calendar className="w-4 h-4" />
            Auto-Pilot Settings
          </Button>
        </div>
      </div>

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

      <Tabs value={curationTab} onValueChange={setCurationTab} className="space-y-6">
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                              <Button size="icon" variant="ghost" className="h-7 w-7"><ExternalLink className="w-3 h-3" /></Button>
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"><XCircle className="w-3 h-3" /></Button>
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
                      {["AI Infrastructure", "Sovereign Computing", "Neural Mesh", "Distributed VRAM"].map(tag => (
                        <Badge key={tag} className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 cursor-pointer">
                          {tag} <XCircle className="w-3 h-3 ml-1.5" />
                        </Badge>
                      ))}
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] border border-dashed border-border"><Plus className="w-3 h-3 mr-1" /> Add</Button>
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                        <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs">
                          <Clock className="w-3 h-3" /> Schedule
                        </Button>
                      </div>
                      <div className="p-4 rounded-xl bg-muted/50 border min-h-[100px] relative">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                        <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6"><RefreshCw className="w-3 h-3" /></Button>
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                        <Button variant="outline" className="flex-1 h-10 gap-2 border-red-500/20 text-red-500 hover:bg-red-500/10">
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                        <Button variant="link" className="text-accent p-0 h-auto text-xs gap-1">
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
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
    // UI-AUDIT-FINDING: SUSPICIOUS-BUTTON: Button has no onClick and is not type='submit'.
    // UI-AUDIT-SUGGESTION: SUGGESTION: Add an onClick handler or change type to 'submit' if in a form.
                      <Button variant="ghost" size="icon" className="h-8 w-8"><ExternalLink className="w-4 h-4" /></Button>
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
  );
}
