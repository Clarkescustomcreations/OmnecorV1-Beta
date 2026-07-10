import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { validatePath } from "../server/_core/security.js";

// Discard console.log/console.error to avoid breaking MCP stdio stream
// MCP uses stdout for its JSON-RPC messages. We should only write JSON-RPC to stdout.
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const server = new Server(
  {
    name: "omnecor-simplified-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);



server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "easy_write_file",
        description: "Creates or overwrites a file with the specified content. Useful for avoiding tricky echo > commands.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The absolute path to the file to write.",
            },
            content: {
              type: "string",
              description: "The content to write into the file.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "easy_append_file",
        description: "Appends text to the end of a file. Useful for avoiding tricky echo >> commands.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The absolute path to the file.",
            },
            content: {
              type: "string",
              description: "The content to append.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "easy_replace_text",
        description: "Replaces exact occurrences of a string in a file with a new string. No regex escaping needed, just provide exact text.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The absolute path to the file.",
            },
            old_text: {
              type: "string",
              description: "The exact text to find and replace.",
            },
            new_text: {
              type: "string",
              description: "The exact text to substitute in.",
            },
          },
          required: ["path", "old_text", "new_text"],
        },
      },
      {
        name: "easy_read_lines",
        description: "Reads a specific range of lines from a file. 1-indexed. Useful to avoid head/tail math.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The absolute path to the file.",
            },
            start_line: {
              type: "number",
              description: "The starting line number (1-indexed).",
            },
            end_line: {
              type: "number",
              description: "The ending line number (inclusive).",
            },
          },
          required: ["path", "start_line", "end_line"],
        },
      },
      {
        name: "easy_list_directory",
        description: "Lists the contents of a directory without needing ls flags.",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "The absolute path to the directory.",
            },
          },
          required: ["directory"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "easy_write_file") {
      const { path: filePath, content } = args as { path: string, content: string };
      const resolved = await validatePath(filePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully wrote to ${resolved}` }]
      };
    }

    if (name === "easy_append_file") {
      const { path: filePath, content } = args as { path: string, content: string };
      const resolved = await validatePath(filePath);
      await fs.appendFile(resolved, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully appended to ${resolved}` }]
      };
    }

    if (name === "easy_replace_text") {
      const { path: filePath, old_text, new_text } = args as { path: string, old_text: string, new_text: string };
      const resolved = await validatePath(filePath);
      let fileContent = await fs.readFile(resolved, "utf-8");
      if (!fileContent.includes(old_text)) {
         return {
           content: [{ type: "text", text: `Error: Could not find exact match for old_text in ${resolved}` }],
           isError: true
         };
      }
      // Replace all occurrences using split/join to avoid regex syntax issues
      fileContent = fileContent.split(old_text).join(new_text);
      await fs.writeFile(resolved, fileContent, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully replaced text in ${resolved}` }]
      };
    }

    if (name === "easy_read_lines") {
      const { path: filePath, start_line, end_line } = args as { path: string, start_line: number, end_line: number };
      const resolved = await validatePath(filePath);
      const fileContent = await fs.readFile(resolved, "utf-8");
      const lines = fileContent.split("\\n");
      // 1-indexed to 0-indexed bounds
      const startIdx = Math.max(0, start_line - 1);
      const endIdx = Math.min(lines.length, end_line);
      const slice = lines.slice(startIdx, endIdx);
      return {
        content: [{ type: "text", text: slice.join("\\n") }]
      };
    }

    if (name === "easy_list_directory") {
      const { directory } = args as { directory: string };
      const resolved = await validatePath(directory);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const result = entries.map(e => `${e.isDirectory() ? '[DIR ]' : '[FILE]'} ${e.name}`).join("\\n");
      return {
        content: [{ type: "text", text: result || "Directory is empty." }]
      };
    }

  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
      isError: true
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(() => process.exit(1));
