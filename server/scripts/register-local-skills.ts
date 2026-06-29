import { config } from "dotenv";
config();
import { getDb } from "../db.factory.js";
import { mcpServerConfigs } from "../../drizzle/schema.js";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  
  // Check if it already exists
  const existing = await db.select().from(mcpServerConfigs).where(eq(mcpServerConfigs.name, "Local Skills"));
  if (existing.length > 0) {
    console.log("Local Skills MCP Server is already registered!");
    process.exit(0);
  }

  // Register the new MCP Server
  await db.insert(mcpServerConfigs).values({
    id: uuid(),
    name: "Local Skills",
    transport: "stdio",
    command: "npx",
    args: ["tsx", "server/scripts/mcp-local-skills.ts"],
    url: null,
  });

  console.log("Successfully registered 'Local Skills' MCP Server in Omnecor!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
