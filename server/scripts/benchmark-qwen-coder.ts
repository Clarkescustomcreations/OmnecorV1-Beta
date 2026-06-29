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
  process.env.ollamaUrl = "http://192.168.1.201:11434";

  console.log("==========================================");
  console.log("🚀 Starting Benchmark Test on Ollama (qwen2.5-coder:7b)...");
  console.log("==========================================\n");

  const worker = LocalSubAgentWorker.getInstance();
  
  const testCases = [
    "Use the `execute_sandbox` tool to run python3 and print out the string 'Test 1 Passed'.",
    "Use the `execute_sandbox` tool to list the files in the 'docs/ai-agents' directory and print the output.",
    "Use the `execute_sandbox` tool to create a python script that prints the sum of 42 and 15, run it, and output the result."
  ];

  console.log(`Running ${testCases.length} benchmark tests...`);

  for (let i = 0; i < testCases.length; i++) {
    console.log(`\n--- Test ${i + 1} ---`);
    console.log(`Goal: ${testCases[i]}`);
    const startTime = Date.now();
    try {
      const result = await worker.executeTask({
        providerId: "ollama",
        modelId: "qwen2.5-coder:7b",
        systemPrompt: systemPrompt,
        goal: testCases[i],
        maxRetries: 5,
        baseUrl: process.env.OLLAMA_BASE_URL
      });
      const endTime = Date.now();
      console.log(`⏱ Time taken: ${(endTime - startTime) / 1000} seconds`);
      console.log(`Result: ${result}`);
    } catch (e: any) {
      console.log(`Failed: ${e.message}`);
    }
  }

  console.log("\n==========================================");
  console.log("✅ ALL BENCHMARKS COMPLETED");
  console.log("==========================================");
}

main().catch(e => {
  console.error("Test Failed:", e);
  process.exit(1);
});
