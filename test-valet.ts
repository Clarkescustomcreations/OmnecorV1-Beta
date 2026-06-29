import 'dotenv/config';
import { ValetRouterService } from "./server/phase2/services/ValetRouterService.js";
import { AiProviderService } from "./server/phase2/services/AiProviderService.js";

async function run() {
  console.log("Testing ValetRouterService Fallback with OpenAI...");
  
  const valet = ValetRouterService.getInstance();
  
  const req1 = { task: "Can you write a react component for a login form?", availableProviders: ["openai"] };
  const req2 = { task: "Generate an image of a cybernetic cat", availableProviders: ["openai"] };
  const req3 = { task: "Explain quantum computing in simple terms", availableProviders: ["openai"] };

  console.log("Task 1:", req1.task);
  const res1 = await valet.route(req1 as any);
  console.log("Decision 1:", res1.category, "| Reasoning:", res1.reasoning);
  
  console.log("\nTask 2:", req2.task);
  const res2 = await valet.route(req2 as any);
  console.log("Decision 2:", res2.category, "| Reasoning:", res2.reasoning);

  console.log("\nTask 3:", req3.task);
  const res3 = await valet.route(req3 as any);
  console.log("Decision 3:", res3.category, "| Reasoning:", res3.reasoning);
}

run().catch(console.error);
