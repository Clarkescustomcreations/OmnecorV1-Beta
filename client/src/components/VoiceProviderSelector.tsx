import React, { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Mic, Volume2, Cloud, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const VoiceProviderSelector: React.FC = () => {
  const [provider, setProvider] = useState<"xtts" | "elevenlabs">("xtts");
  const [testText, setTestText] = useState("Hello, this is a test of the Omnecor voice system.");
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const elevenLabsStatus = trpc.voice.elevenLabsStatus.useQuery();
  const voicesQuery = trpc.voice.listElevenLabsVoices.useQuery(undefined, {
    enabled: provider === "elevenlabs" && (elevenLabsStatus.data?.configured ?? false),
  });

  const synthesizeMutation = trpc.voice.synthesizeElevenLabs.useMutation({
    onSuccess: (data) => {
      const src = `data:${data.mimeType};base64,${data.audioBase64}`;
      if (audioRef.current) {
        audioRef.current.src = src;
        audioRef.current.play().catch(() => toast.error("Could not play audio"));
      }
      toast.success(`Synthesized ${data.characterCount} characters`);
    },
    onError: (e) => toast.error("Synthesis failed: " + e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5" aria-hidden="true" />
          Voice Provider
        </CardTitle>
        <CardDescription>Choose between local XTTS and cloud ElevenLabs voice synthesis.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={provider === "xtts" ? "default" : "outline"}
            size="sm"
            onClick={() => setProvider("xtts")}
            aria-pressed={provider === "xtts"}
          >
            <HardDrive className="w-4 h-4 mr-1" aria-hidden="true" />
            Local XTTS
          </Button>
          <Button
            variant={provider === "elevenlabs" ? "default" : "outline"}
            size="sm"
            onClick={() => setProvider("elevenlabs")}
            aria-pressed={provider === "elevenlabs"}
          >
            <Cloud className="w-4 h-4 mr-1" aria-hidden="true" />
            ElevenLabs
            {elevenLabsStatus.data?.configured
              ? <Badge variant="default" className="ml-1 text-[10px] py-0">Active</Badge>
              : <Badge variant="secondary" className="ml-1 text-[10px] py-0">Not configured</Badge>
            }
          </Button>
        </div>

        {provider === "elevenlabs" && !elevenLabsStatus.data?.configured && (
          <p className="text-xs text-muted-foreground rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            Add <code className="font-mono bg-muted px-1 rounded">ELEVENLABS_API_KEY</code> to your <code className="font-mono bg-muted px-1 rounded">.env</code> and restart the server.
          </p>
        )}

        {provider === "elevenlabs" && elevenLabsStatus.data?.configured && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="voice-select">Voice</Label>
              <Select value={selectedVoiceId} onValueChange={setSelectedVoiceId}>
                <SelectTrigger id="voice-select" aria-label="Select ElevenLabs voice">
                  <SelectValue placeholder={voicesQuery.isLoading ? "Loading voices…" : "Select a voice"} />
                </SelectTrigger>
                <SelectContent>
                  {(voicesQuery.data?.voices ?? []).map(v => (
                    <SelectItem key={v.voice_id} value={v.voice_id}>
                      {v.name} <span className="text-xs text-muted-foreground ml-1">({v.category})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="test-text">Test text</Label>
              <Input
                id="test-text"
                value={testText}
                onChange={e => setTestText(e.target.value)}
                placeholder="Enter text to synthesize…"
                maxLength={5000}
              />
            </div>

            <Button
              onClick={() => synthesizeMutation.mutate({ voiceId: selectedVoiceId || "21m00Tcm4TlvDq8ikWAM", text: testText })}
              disabled={synthesizeMutation.isPending || !testText}
              aria-label="Synthesize speech with ElevenLabs"
            >
              {synthesizeMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Synthesizing…</>
                : <><Volume2 className="w-4 h-4 mr-2" aria-hidden="true" />Synthesize</>
              }
            </Button>

            <audio ref={audioRef} controls className="w-full mt-2" aria-label="Synthesized speech playback" />
          </div>
        )}

        {provider === "xtts" && (
          <p className="text-xs text-muted-foreground">Local XTTS-v2 voice synthesis. Configure via the Voice tab in Settings.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default VoiceProviderSelector;
