import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Provider = "local" | "fal" | "openart";

const PROVIDER_LABELS: Record<Provider, string> = {
  local: "ComfyUI (Local)",
  fal: "Fal.ai",
  openart: "OpenArt",
};

export default function ImageGeneratorPanel() {
  const [provider, setProvider] = useState<Provider>("local");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);

  const providers = (trpc as any).imageGen?.providers?.useQuery?.();
  const generate = (trpc as any).imageGen?.generate?.useMutation?.({
    onError: (err: { message?: string }) => toast.error(`Generation failed: ${err?.message}`),
  });

  const providerData = providers?.data as { local: boolean; fal: boolean; openart: boolean } | undefined;

  const isDisabled = (p: Provider) => {
    if (p === "fal" && providerData && !providerData.fal) return true;
    if (p === "openart" && providerData && !providerData.openart) return true;
    return false;
  };

  const resultUrl: string | null = (generate?.data as any)?.imageUrl ?? null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["local", "fal", "openart"] as Provider[]).map(p => (
          <button
            key={p}
            onClick={() => !isDisabled(p) && setProvider(p)}
            disabled={isDisabled(p)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              provider === p
                ? "bg-blue-600 text-white"
                : isDisabled(p)
                ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {PROVIDER_LABELS[p]}
            {isDisabled(p) && " (not configured)"}
          </button>
        ))}
      </div>

      <Textarea
        placeholder="Describe the image..."
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={3}
      />

      {(provider === "fal" || provider === "openart") && (
        <Input
          placeholder="Model (optional)"
          value={model}
          onChange={e => setModel(e.target.value)}
        />
      )}

      <div className="flex gap-3 items-center">
        <label className="text-sm text-gray-400">
          W
          <Input
            type="number"
            value={width}
            onChange={e => setWidth(Number(e.target.value))}
            className="w-20 ml-1 inline-block"
            min={64}
            max={2048}
          />
        </label>
        <label className="text-sm text-gray-400">
          H
          <Input
            type="number"
            value={height}
            onChange={e => setHeight(Number(e.target.value))}
            className="w-20 ml-1 inline-block"
            min={64}
            max={2048}
          />
        </label>
      </div>

      <Button
        onClick={() => generate?.mutate?.({ prompt, provider, model: model || undefined, width, height })}
        disabled={generate?.isPending || !prompt.trim()}
      >
        {generate?.isPending ? "Generating..." : "Generate"}
      </Button>

      {generate?.isError && (
        <p className="text-red-400 text-sm">{(generate.error as any)?.message}</p>
      )}

      {resultUrl && (
        <img src={resultUrl} alt="Generated" className="w-full rounded-lg mt-2 max-h-96 object-contain" />
      )}
    </div>
  );
}
