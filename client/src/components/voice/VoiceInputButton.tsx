import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { WebSocketManager } from '../../lib/websocket';
import { toast } from 'sonner';
import { HowToTooltip } from "@/components/shell/HowToTooltip";

export const VoiceInputButton: React.FC<{
  onTranscription: (text: string) => void;
  className?: string;
  size?: "sm" | "md";
}> = ({ onTranscription, className, size = "md" }) => {
  const sizeClass = size === "sm" ? "h-12 w-12 sm:h-7 sm:w-7" : "h-14 w-14 sm:h-10 sm:w-10";
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
        await sendAudioToWhisper(audioBlob);
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      toast.info("Listening...");
    } catch (err) {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const sendAudioToWhisper = async (blob: Blob) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const ws = WebSocketManager.getInstance();
      ws.send("voice.transcribe", { audio: base64data.split(',')[1] });
    };
  };

  useEffect(() => {
    const ws = WebSocketManager.getInstance();
    const unsub = ws.on<{ text: string }>("voice.transcription", (data) => {
      onTranscription(data.text);
      setIsProcessing(false);
      toast.success("Voice transcribed");
    });
    return () => unsub();
  }, [onTranscription]);

  return (
    <HowToTooltip title="Voice Input" description="Hold to speak, release to send" side="top">
      <Button
        variant={isRecording ? "destructive" : "outline"}
        size="icon"
        type="button"
        className={`rounded-full ${sizeClass} transition-all ${isRecording ? 'animate-pulse scale-110 shadow-lg' : ''} ${className ?? ''}`}
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        disabled={isProcessing}
      >
        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </Button>
    </HowToTooltip>
  );
};
