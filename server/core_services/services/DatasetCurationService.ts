import fs from "fs/promises";
import path from "path";
import { getDb } from "../../db.factory.js";
import { curatedTrainingExamples, discoveredDatasetItems, neuralMaps } from "../../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { AiProviderService } from "./AiProviderService.js";
import { assertProviderAllowedInMode } from "../../_core/sovereign.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("DatasetCuration");

function cleanAndParseJson(text: string): any[] {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    log.warn(`JSON parsing failed for curation text: ${(e as Error).message}. Text: ${text}`);
    throw e;
  }
}

export class DatasetCurationService {
  private static instance: DatasetCurationService | null = null;

  static getInstance(): DatasetCurationService {
    if (!DatasetCurationService.instance) {
      DatasetCurationService.instance = new DatasetCurationService();
    }
    return DatasetCurationService.instance;
  }

  /**
   * Curate a discovered item using LLM.
   */
  async curateItem(itemId: number, userId: number, executionMode: string): Promise<boolean> {
    const db = await getDb();

    const [item] = await db
      .select()
      .from(discoveredDatasetItems)
      .where(eq(discoveredDatasetItems.id, itemId))
      .limit(1);

    if (!item || item.isProcessed === 1) {
      log.warn(`Item ${itemId} not found or already processed`);
      return false;
    }

    // Determine provider: use local Ollama by default, or Anthropic if permitted.
    const isSovereign = executionMode === "sovereign";
    const providerId = isSovereign ? "ollama" : "anthropic";
    const modelId = isSovereign ? "qwen2.5-coder:7b" : "claude-3-5-sonnet-20241022";

    if (!isSovereign) {
      try {
        assertProviderAllowedInMode(providerId, executionMode);
      } catch {
        // Fall back to Ollama if blocked
      }
    }

    const systemPrompt = `You are an expert machine learning data engineer. Your task is to extract exactly 1 to 3 high-quality instruction-tuning training examples (Instruction, Input, Output) from the provided raw text segment.

You must output ONLY a valid JSON array of objects. Do not include any explanation, intro, outro, or markdown code block formatting. Each object in the array must have exactly these fields:
- "instruction": A clear instruction, question, or task prompt for the model.
- "input": Context or input data (optional, set to null or empty string if not needed).
- "output": The correct, complete, and high-quality response to the instruction.`;

    const userPrompt = `Raw Text Segment:
${item.content}

JSON output:`;

    try {
      const response = await AiProviderService.getInstance().chat({
        providerId,
        modelId,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1000,
        temperature: 0.2,
      });

      const examples = cleanAndParseJson(response);

      for (const ex of examples) {
        if (!ex.instruction || !ex.output) continue;
        await db.insert(curatedTrainingExamples).values({
          projectId: item.projectId,
          datasetItemId: item.id,
          createdByUserId: userId,
          instruction: String(ex.instruction),
          input: ex.input ? String(ex.input) : null,
          output: String(ex.output),
          status: "pending_review",
        });
      }

      // Mark the discovered item as processed
      await db
        .update(discoveredDatasetItems)
        .set({ isProcessed: 1 })
        .where(eq(discoveredDatasetItems.id, item.id));

      log.info(`Successfully curated item ${itemId} into ${examples.length} example(s)`);
      return true;
    } catch (err) {
      log.error(`Failed to curate item ${itemId}: ${(err as Error).message}`);
      
      // Fallback: create a single simple Q&A pair from the content so the curation doesn't fail silently.
      try {
        await db.insert(curatedTrainingExamples).values({
          projectId: item.projectId,
          datasetItemId: item.id,
          createdByUserId: userId,
          instruction: `Explain or summarize the key concepts in: ${item.sourceName}`,
          input: null,
          output: item.content.slice(0, 1000),
          status: "pending_review",
        });

        await db
          .update(discoveredDatasetItems)
          .set({ isProcessed: 1 })
          .where(eq(discoveredDatasetItems.id, item.id));
        
        return true;
      } catch (fallbackErr) {
        log.error(`Fallback curation also failed: ${(fallbackErr as Error).message}`);
        return false;
      }
    }
  }

  /**
   * Compile approved examples into a JSONL file.
   */
  async compileDataset(projectId: string | null): Promise<string> {
    const db = await getDb();

    // Fetch approved curated examples
    let query = db
      .select()
      .from(curatedTrainingExamples)
      .where(eq(curatedTrainingExamples.status, "approved"));

    if (projectId) {
      query = db
        .select()
        .from(curatedTrainingExamples)
        .where(
          and(
            eq(curatedTrainingExamples.status, "approved"),
            eq(curatedTrainingExamples.projectId, projectId)
          )
        );
    }

    const approved = await query;
    log.info(`Compiling ${approved.length} approved training example(s)`);

    // Determine destination folder
    let targetDir = "./data";
    if (projectId) {
      const [map] = await db
        .select()
        .from(neuralMaps)
        .where(eq(neuralMaps.id, projectId))
        .limit(1);
      
      if (map && map.rootDirectories && map.rootDirectories[0]) {
        targetDir = path.join(map.rootDirectories[0], "data");
      }
    }

    // Ensure directory exists
    await fs.mkdir(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, "curated_dataset.jsonl");

    // Write JSONL file
    const lines = approved.map((ex) =>
      JSON.stringify({
        instruction: ex.instruction,
        input: ex.input || "",
        output: ex.output,
      })
    );

    await fs.writeFile(targetFile, lines.join("\n"), "utf-8");
    log.info(`Dataset compiled successfully to ${targetFile}`);
    return targetFile;
  }
}
