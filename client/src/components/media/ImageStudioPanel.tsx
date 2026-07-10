import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { ImageIcon, Wand2, Download, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

export const ImageStudioPanel: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  const [gallerySearch, setGallerySearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [defaultStyle, setDefaultStyle] = useState("Realistic");
  const [imageSize, setImageSize] = useState("768x768");

  const imagesQuery = trpc.fal.listImages.useQuery();
  const generateMutation = trpc.fal.generateImage.useMutation({
    onSuccess: () => {
      toast.success("Generation complete");
      imagesQuery.refetch();
    },
    onError: (err) => toast.error("Image generation failed: " + err.message),
  });

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="p-6 border-b bg-muted/30">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-accent-purple" />
            <h1 className="text-xl font-bold tracking-tight">Neural Image Studio</h1>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="A futuristic cybernetic interface with neural networks..."
                className="pr-12 h-12 shadow-inner"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <HowToTooltip title="Studio Settings" description="Configure default style and output size" side="top">
                <Settings2
                  className="absolute right-4 top-3.5 w-5 h-5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => setShowSettings(s => !s)}
                />
              </HowToTooltip>
            </div>
            <HowToTooltip title="Generate Image" description="Create an image from the text prompt" side="top">
              <Button 
                className="h-12 px-8 bg-gradient-to-r from-accent-purple to-accent-info hover:opacity-90 transition-all shadow-lg"
                onClick={() => generateMutation.mutate({ prompt })}
                disabled={!prompt || generateMutation.isPending}
              >
                {generateMutation.isPending ? "Dreaming..." : <><Wand2 className="w-4 h-4 mr-2" /> Generate</>}
              </Button>
            </HowToTooltip>
          </div>
          {showSettings && (
            <div className="mt-4 p-4 rounded-lg border bg-muted/30 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Default Style</label>
                <div className="flex gap-2 flex-wrap">
                  {["Realistic", "Anime", "Digital Art", "Oil Painting"].map((style) => (
                    <button
                      key={style}
                      onClick={() => setDefaultStyle(style)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        defaultStyle === style
                          ? "bg-accent-purple text-white"
                          : "bg-muted border hover:bg-muted/80"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Image Size</label>
                <select
                  value={imageSize}
                  onChange={(e) => setImageSize(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border bg-background"
                >
                  <option value="512x512">512x512</option>
                  <option value="768x768">768x768</option>
                  <option value="1024x1024">1024x1024</option>
                </select>
              </div>
              <Button
                size="sm"
                className="w-full bg-accent-purple hover:bg-accent-purple"
                onClick={() => {
                  toast.success("Settings saved");
                  setShowSettings(false);
                }}
              >
                Save Settings
              </Button>
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Gallery</h3>
            <div className="flex gap-2">
               <div className="relative">
                 <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                 <Input
                   className="pl-9 h-9 w-64 bg-muted/50 border-none"
                   placeholder="Search your creations..."
                   value={gallerySearch}
                   onChange={(e) => setGallerySearch(e.target.value)}
                 />
               </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {(imagesQuery.data as unknown as Array<{ id: string; url: string; prompt: string }>)
              ?.filter(img => !gallerySearch || img.prompt?.toLowerCase().includes(gallerySearch.toLowerCase()))
              .map((img) => (
              <Card key={img.id} className="group relative overflow-hidden aspect-square border-none bg-muted rounded-xl transition-all hover:ring-2 hover:ring-accent-purple shadow-sm">
                <img src={img.url} alt={img.prompt} className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end">
                  <p className="text-[10px] text-white/90 line-clamp-2 leading-relaxed mb-3">{img.prompt}</p>
                  <div className="flex gap-2">
                    <HowToTooltip title="Download Image" description="Save this generated image" side="top">
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-7 w-7 rounded-full bg-white/20 backdrop-blur hover:bg-white/40 border-none"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = img.url;
                          a.download = `omnecor-${img.id}.png`;
                          a.target = "_blank";
                          a.click();
                        }}
                      >
                        <Download className="h-3.5 w-3.5 text-white" />
                      </Button>
                    </HowToTooltip>
                  </div>
                </div>
              </Card>
            ))}
            {imagesQuery.isLoading && [1,2,3,4,5].map(i => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
          
          {!imagesQuery.data?.length && !imagesQuery.isLoading && (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <ImageIcon className="w-12 h-12 mb-4 opacity-10" />
              <p className="text-sm italic">Your dream gallery is empty. Start generating!</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
