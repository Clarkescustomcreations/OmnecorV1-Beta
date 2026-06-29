import { config } from "dotenv";
config();
import { AiProviderService } from "../phase2/services/AiProviderService.js";
import { LocalSubAgentWorker } from "../phase2/services/LocalSubAgentWorker.js";
import fs from "fs/promises";
import path from "path";

async function main() {
  const promptPath = path.resolve(process.cwd(), "agents/4B-Logic-Controller-Prompt.md");
  const systemPrompt = await fs.readFile(promptPath, "utf-8");

  const aiService = AiProviderService.getInstance();

  if (!process.env.OLLAMA_BASE_URL) {
    process.env.OLLAMA_BASE_URL = "http://192.168.1.201:11434";
  }
  // also set the setting explicitly to override defaults if any
  process.env.ollamaUrl = "http://192.168.1.201:11434";

  console.log("==========================================");
  console.log("🚀 Starting 4B Logic Controller Test on Ollama (qwen2.5-coder:3b)...");
  console.log("==========================================\n");

  const worker = LocalSubAgentWorker.getInstance();
  
  const result = await worker.executeTask({
    providerId: "ollama",
    modelId: "qwen2.5:7b",
    systemPrompt: systemPrompt,
    goal: "Use your tools to look up the local 'tailwind-css' skill and tell me what its core rule or description is.",
    maxRetries: 5,
    baseUrl: "http://192.168.1.201:11434"
  });

  console.log("\n\n==========================================");
  console.log("✅ TEST COMPLETED");
  console.log("==========================================");
  console.log(result);
}

main().catch(e => {
  console.error("Test Failed:", e);
  process.exit(1);
});
