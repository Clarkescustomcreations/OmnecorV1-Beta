# Omnecor Skills & MCP Extensions

Omnecor is designed to be highly extensible. Through **Model Context Protocol (MCP)** and **Agent Skills**, you can equip the AI running inside Omnecor with new tools, logic, and capabilities. 

To maximize visibility and ease of use, all native extensions live at the root of the Omnecor directory:
- `/skills/` — Contains Markdown (`.md`) instructions for the AI.
- `/mcp/` — Contains custom MCP server scripts.

---

## Included Extension: "Simplified Tools"

By default, Omnecor includes a custom built-in MCP server and Skill called **Simplified Tools**.

### The Problem
Smaller, locally hosted AI models (like Llama 3 8B, Mistral, etc.) often struggle with complex bash commands. They fumble syntax, forget quotes, or accidentally run dangerous recursive commands when trying to explore the filesystem or read code.

### The Solution
The **Simplified Tools** MCP provides reliable, dedicated JSON-RPC tools for these models:
- `mcp_list_directory` — Safely lists files and folders.
- `mcp_read_file` — Reads file contents with built-in line limiting.
- `mcp_write_file` — Safely writes code without needing `cat` or `echo`.
- `mcp_search_code` — A native regex search wrapper.

**Security:** These tools strictly use Omnecor's internal `validatePath` security sandbox. The AI cannot read or write outside of your designated active project boundaries.

The corresponding Skill (`/skills/simplified-tools/SKILL.md`) instructs the AI to *prefer* these tools over raw bash, dramatically reducing errors for smaller models.

---

## How to Add Your Own Skills & MCPs

You can easily add your own workflows or tools to Omnecor.

### 1. Adding a Custom Skill
A "Skill" is simply a Markdown file that gives the AI instructions on how to behave, how to use its tools, or how to solve specific problems.

1. Create a new folder in `/skills/`. (e.g., `/skills/my-custom-skill/`)
2. Create a file named `SKILL.md` inside that folder.
3. Write your instructions in Markdown format.

Omnecor's built-in `omnecor-local-skills` MCP server automatically scans the `/skills/` directory at runtime. The AI can use its `read_agent_skill` tool to dynamically load your instructions whenever needed!

### 2. Adding a Custom MCP Server
An MCP (Model Context Protocol) Server provides executable tools (like fetching APIs, running databases, etc.) to the AI.

1. Drop your MCP script (e.g., `my-server.ts`) into the `/mcp/` directory.
2. Register the server in Omnecor's database. You can do this by executing a simple script or via the Omnecor UI (Settings > Integrations > MCP).

Example registration script (run with `npx tsx`):
```typescript
import { db } from "../server/db.factory.js";
import { mcpServerConfigs } from "../drizzle/schema.js";
import { v4 as uuid } from "uuid";

await db.insert(mcpServerConfigs).values({
  id: uuid(),
  name: "My Custom Server",
  transport: "stdio",
  command: "npx",
  args: ["tsx", "mcp/my-server.ts"],
});
```

Once registered, the AI inside Omnecor will immediately be able to see and use the new tools provided by your MCP server!
