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
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import PersonaCreationPanel from "@/components/settings/PersonaCreationPanel";

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
  const [activeTab, setActiveTab] = useState("calendar");
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const personas = loadPersonaList();

  // Queries
  const { data: scheduledPostsData, isLoading: isLoadingScheduled, refetch: refetchScheduled } = trpc.scheduling.listScheduledPosts.useQuery({ limit: 50 });
  const { data: accountsData, isLoading: isLoadingAccounts } = trpc.platforms.listAccounts.useQuery();
  const { data: unprocessedArticles, isLoading: isLoadingDiscovery, refetch: refetchDiscovery } = trpc.discovery.listUnprocessed.useQuery({ limit: 10 });
  const { data: analyticsSummary, isLoading: isLoadingAnalytics } = trpc.analytics.getPlatformSummary.useQuery();
  const { data: pendingPosts, isLoading: isLoadingPending, refetch: refetchPending } = trpc.curator.listByStatus.useQuery({ status: "pending_review" });

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
            {/* Agent / Persona selector */}
            <div className="flex items-center gap-2">
              <UserCircle2 className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue placeholder="Select agent / persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No persona</SelectItem>
                  {personas.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.avatarDataUrl ? (
                        <img src={p.avatarDataUrl} alt="" className="inline-block w-4 h-4 rounded-full object-cover mr-1.5" />
                      ) : null}
                      {p.name}
                    </SelectItem>
                  ))}
                  {personas.length === 0 && (
                    <SelectItem value="__none" disabled>No personas created yet</SelectItem>
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
          </TabsList>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Post Calendar</CardTitle>
                  <CardDescription>Upcoming scheduled social media posts.</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> New Post
                </Button>
              </CardHeader>
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
                          <Button variant="ghost" size="sm">Edit</Button>
                          <Button size="sm">Publish Now</Button>
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
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Disconnect</Button>
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
                          <Button size="sm" variant="outline">Curate</Button>
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
        </Tabs>
      </div>
    </OmnecorDashboardLayout>
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
  accountsData: unknown[] | undefined;
  refetch: () => void;
}) {
  const getAuthUrlMutation = trpc.oauth.getAuthorizationUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => toast.error(`OAuth failed: ${error.message}`),
  });

  const connectedPlatforms = new Set(
    accountsData?.map((a) => (a as any).platform?.toLowerCase() ?? "") || []
  );

  const handleConnect = (platform: string) => {
    getAuthUrlMutation.mutate({ platform });
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
