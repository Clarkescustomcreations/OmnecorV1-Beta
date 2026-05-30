import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { ImageIcon, Wand2, Download, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";

export const ImageStudioPanel: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  
  const imagesQuery = trpc.media.listImages.useQuery();
  const generateMutation = trpc.media.generateImage.useMutation({
    onSuccess: () => {
      toast.success("Generation complete");
      imagesQuery.refetch();
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-6 border-b bg-muted/30">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-purple-500" />
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
              <Settings2 className="absolute right-4 top-3.5 w-5 h-5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
            </div>
            <Button 
              className="h-12 px-8 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg"
              onClick={() => generateMutation.mutate({ prompt })}
              disabled={!prompt || generateMutation.isPending}
            >
              {generateMutation.isPending ? "Dreaming..." : <><Wand2 className="w-4 h-4 mr-2" /> Generate</>}
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Gallery</h3>
            <div className="flex gap-2">
               <div className="relative">
                 <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                 <Input className="pl-9 h-9 w-64 bg-muted/50 border-none" placeholder="Search your creations..." />
               </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {imagesQuery.data?.map((img: any) => (
              <Card key={img.id} className="group relative overflow-hidden aspect-square border-none bg-muted rounded-xl transition-all hover:ring-2 hover:ring-purple-500 shadow-sm">
                <img src={img.url} alt={img.prompt} className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end">
                  <p className="text-[10px] text-white/90 line-clamp-2 leading-relaxed mb-3">{img.prompt}</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="icon" className="h-7 w-7 rounded-full bg-white/20 backdrop-blur hover:bg-white/40 border-none">
                      <Download className="h-3.5 w-3.5 text-white" />
                    </Button>
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
