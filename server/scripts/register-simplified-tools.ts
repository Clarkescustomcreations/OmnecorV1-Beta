import { config } from "dotenv";
config();
import { getDb } from "../db.factory.js";
import { mcpServerConfigs } from "../../drizzle/schema.js";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  
  // Check if it already exists
  const existing = await db.select().from(mcpServerConfigs).where(eq(mcpServerConfigs.name, "Simplified Tools"));
  // Register or update the new MCP Server
  const argsPath = "mcp/simplified-tools.ts";
  
  if (existing.length > 0) {
    await db.update(mcpServerConfigs)
      .set({ args: ["tsx", argsPath] })
      .where(eq(mcpServerConfigs.name, "Simplified Tools"));
    console.log("Successfully updated 'Simplified Tools' MCP Server path!");
    process.exit(0);
  }

  await db.insert(mcpServerConfigs).values({
    id: uuid(),
    name: "Simplified Tools",
    transport: "stdio",
    command: "npx",
    args: ["tsx", argsPath],
    url: null,
  });

  console.log("Successfully registered 'Simplified Tools' MCP Server in Omnecor!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
