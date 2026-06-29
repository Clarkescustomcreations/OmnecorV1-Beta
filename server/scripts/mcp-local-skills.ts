import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Discard console.log/console.error to avoid breaking MCP stdio stream
// MCP uses stdout for its JSON-RPC messages. We should only write JSON-RPC to stdout.
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const server = new Server(
  {
    name: "omnecor-local-skills",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Standard local paths for agent skills
const SKILL_PATHS = [
  path.join(os.homedir(), ".gemini", "antigravity-cli", "skills"),
  path.join(os.homedir(), ".gemini", "config", "skills"),
  path.join(os.homedir(), ".gemini", "skills")
];

async function scanSkills(): Promise<{ name: string; path: string; description?: string }[]> {
  const skills: { name: string; path: string; description?: string }[] = [];
  
  for (const basePath of SKILL_PATHS) {
    try {
      const stats = await fs.stat(basePath);
      if (!stats.isDirectory()) continue;
      
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(basePath, entry.name, "SKILL.md");
          try {
            const skillContent = await fs.readFile(skillPath, "utf-8");
            let description = `A custom agent skill for ${entry.name}.`;
            // Very rudimentary frontmatter parsing for description
            const descMatch = skillContent.match(/description:\s*(.*?)\n/);
            if (descMatch && descMatch[1]) {
              description = descMatch[1].replace(/["']/g, "").trim();
            }
            skills.push({ name: entry.name, path: skillPath, description });
          } catch (e) {
            // SKILL.md not found or unreadable, skip
          }
        }
      }
    } catch (e) {
      // Directory doesn't exist or is unreadable, skip
    }
  }
  return skills;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const skills = await scanSkills();
  return {
    tools: [
      {
        name: "list_agent_skills",
        description: "Lists all locally installed agent skills on this PC.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "read_agent_skill",
        description: "Reads the SKILL.md instructions for a specific local skill.",
        inputSchema: {
          type: "object",
          properties: {
            skill_name: {
              type: "string",
              description: "The exact name of the skill to read (e.g. 'tailwind-css')",
            },
          },
          required: ["skill_name"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const skills = await scanSkills();

  if (name === "list_agent_skills") {
    return {
      content: [
        {
          type: "text",
          text: `Found ${skills.length} skills on this PC:\n\n` + 
                skills.map(s => `- **${s.name}**: ${s.description}`).join("\n")
        },
      ],
    };
  }

  if (name === "read_agent_skill") {
    const skillName = (args as { skill_name: string }).skill_name;
    const skill = skills.find(s => s.name === skillName);
    
    if (!skill) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Skill '${skillName}' not found on this PC. Try using list_agent_skills first to see available skills.`
          }
        ]
      };
    }

    try {
      const content = await fs.readFile(skill.path, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content
          }
        ]
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading skill file: ${e.message}`
          }
        ]
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(() => process.exit(1));
