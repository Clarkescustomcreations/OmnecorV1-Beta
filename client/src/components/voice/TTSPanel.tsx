import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { Slider } from "../ui/slider"; // Using custom slider patterns
import { Volume2, Music, Download, Wand2 } from "lucide-react";
import { toast } from "sonner";

export const TTSPanel: React.FC = () => {
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const voicesQuery = trpc.voice.listRvcModels.useQuery({ modelsDir: "./models/rvc" });
  const synthMutation = trpc.voice.synthesize.useMutation({
    onSuccess: (data) => {
      // Assuming data.audio is a base64 string
      const blob = b64toBlob("", 'audio/wav');
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      toast.success("Synthesis complete");
    }
  });

  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; sliceSize > 0 && offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="w-5 h-5" /> Neural Voice Synthesis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea 
            placeholder="Enter text to synthesize..." 
            className="min-h-[150px] resize-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Voice Model</label>
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Voice" />
                </SelectTrigger>
                <SelectContent>
                  {voicesQuery.data?.models?.map((v: any) => (
                    <SelectItem key={v.id || v} value={v.id || v}>{v.name || v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button 
                onClick={() => synthMutation.mutate({ text, speakerWavPath: selectedVoice })}
                disabled={!text || !selectedVoice || synthMutation.isPending}
                className="w-40"
              >
                {synthMutation.isPending ? "Generating..." : <><Wand2 className="w-4 h-4 mr-2" /> Synthesize</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {audioUrl && (
        <Card className="bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-blue-500 rounded-full text-white">
              <Music className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Generated Output</p>
              <audio controls src={audioUrl} className="w-full h-8 mt-2" />
            </div>
            <Button variant="outline" size="icon" asChild>
              <a href={audioUrl} download="synthesis.wav">
                <Download className="w-4 h-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
