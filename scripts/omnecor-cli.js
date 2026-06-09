#!/usr/bin/env node

/**
 * Omnecor Terminal/CLI agent.
 * Spawns in system terminal, executes prompts using the active AI models,
 * accesses MCP tools via the local backend API, and routes outputs back to the chat.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}/api/trpc`;

const DATA_DIR = (() => {
  if (process.env.OMNECOR_DATA_DIR) {
    return process.env.OMNECOR_DATA_DIR;
  }
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  const defaultLocalPath = path.join(__dirname, '..', 'data');
  try {
    if (!fs.existsSync(defaultLocalPath)) {
      fs.mkdirSync(defaultLocalPath, { recursive: true });
    }
    const testFile = path.join(defaultLocalPath, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return defaultLocalPath;
  } catch {
    const fallbackPath = path.join(os.homedir(), '.omnecor', 'data');
    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create fallback data directory in home:', err.message);
    }
    return fallbackPath;
  }
})();

const PROMPT_FILE = path.join(DATA_DIR, 'cli_prompt.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'cli_output.json');

async function main() {
  console.log('\n==============================================');
  console.log('         OMNECOR TERMINAL/CLI AGENT           ');
  console.log('==============================================\n');

  // 1. Read pending prompt or ask user
  let promptData = null;
  if (fs.existsSync(PROMPT_FILE)) {
    try {
      const content = fs.readFileSync(PROMPT_FILE, 'utf8');
      promptData = JSON.parse(content);
      // Clear file after read
      fs.writeFileSync(PROMPT_FILE, '{}');
    } catch (err) {
      console.error('Error reading pending prompt:', err);
    }
  }

  let prompt = promptData?.prompt || '';
  let providerId = promptData?.providerId || 'ollama';
  let modelId = promptData?.modelId || 'qwen2.5-coder:7b';
  let sessionId = promptData?.sessionId || '';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  if (!prompt) {
    prompt = await question('Enter your prompt/task: ');
    if (!prompt.trim()) {
      console.log('Prompt cannot be empty. Exiting.');
      rl.close();
      return;
    }
  } else {
    console.log(`Task: "${prompt}"`);
    console.log(`Model: ${providerId} / ${modelId}\n`);
  }

  // 2. Fetch available tools from backend
  console.log('⚡ Loading workstation tools...');
  let tools = [];
  try {
    const res = await fetch(`${BASE_URL}/mcp.listTools?batch=1&input=%7B%220%22%3A%7B%7D%7D`);
    if (res.ok) {
      const data = await res.json();
      tools = data[0]?.result?.data || [];
    }
  } catch (err) {
    console.warn('⚠️ Could not connect to Omnecor backend. Running without tools.', err.message);
  }

  console.log(`✓ Loaded ${tools.length} workstation tools.\n`);

  // 3. Define system prompt for tool calling
  const systemPrompt = `You are the Omnecor CLI Assistant. You are executing in the user's terminal/shell.
You have access to the following MCP tools from the local workstation:
${tools.map(t => `- Tool "${t.name}" (from server "${t.serverId}"): ${t.description}. Schema: ${JSON.stringify(t.inputSchema)}`).join('\n')}

To call a tool, output a single JSON block inside a <tool_call> XML tag, like this:
<tool_call>
{
  "serverId": "server-id",
  "toolName": "tool-name",
  "args": {
    "argName": "value"
  }
}
</tool_call>

Keep in mind:
- You can make multiple tool calls one after another if needed.
- If a tool fails or returns an error, explain it and try to fix the arguments or approach.
- Once you have successfully completed the user's task or if no more tools are needed, output your final answer directly to the user without any <tool_call> tags.
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  let step = 1;
  const maxSteps = 15;
  let running = true;

  while (running && step <= maxSteps) {
    console.log(`\n🤖 Thinking (Step ${step}/${maxSteps})...`);
    
    // Call chat API
    let aiResponse = '';
    try {
      const res = await fetch(`${BASE_URL}/ai.chat?batch=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "0": {
            "json": {
              providerId,
              modelId,
              messages
            }
          }
        })
      });

      if (!res.ok) {
        throw new Error(`Chat API returned ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      aiResponse = data[0]?.result?.data?.content || '';
    } catch (err) {
      console.error('❌ AI Chat execution failed:', err.message);
      break;
    }

    if (!aiResponse) {
      console.log('⚠️ AI returned empty response.');
      break;
    }

    // Check for tool call
    const toolCallMatch = aiResponse.match(/<tool_call>([\s\S]*?)<\/tool_call>/);

    if (toolCallMatch) {
      // Append assistant message
      messages.push({ role: 'assistant', content: aiResponse });
      
      const jsonStr = toolCallMatch[1].trim();
      let toolCall = null;
      try {
        toolCall = JSON.parse(jsonStr);
      } catch (err) {
        console.error('❌ Failed to parse tool call JSON:', err.message);
        messages.push({ role: 'user', content: `Tool call parsing error: ${err.message}. Please output a valid JSON object inside <tool_call> tags.` });
        step++;
        continue;
      }

      const { serverId, toolName, args } = toolCall;
      console.log(`🔧 [Tool Call]: Calling "${toolName}" on server "${serverId}"`);
      console.log(`   Arguments: ${JSON.stringify(args, null, 2)}`);

      let toolResult = '';
      try {
        const res = await fetch(`${BASE_URL}/mcp.callTool?batch=1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            "0": {
              "json": {
                serverId,
                toolName,
                args
              }
            }
          })
        });

        if (!res.ok) {
          throw new Error(`Tool execution API returned ${res.status}`);
        }

        const data = await res.json();
        toolResult = JSON.stringify(data[0]?.result?.data || '');
        console.log(`✓ [Tool Result]: Success`);
      } catch (err) {
        console.error(`❌ [Tool Result]: Failed:`, err.message);
        toolResult = `Error calling tool: ${err.message}`;
      }

      // Feed tool result back
      messages.push({ role: 'user', content: `Tool call result: ${toolResult}` });
      step++;
    } else {
      // Final response
      console.log('\n==============================================');
      console.log('🤖 FINAL RESPONSE:');
      console.log('==============================================\n');
      console.log(aiResponse);
      console.log('\n==============================================\n');
      
      running = false;

      // Ask if they want to send it back to the chat session
      if (sessionId) {
        const ans = await question('Do you want to send this output back to the active chat session? (y/N): ');
        if (ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes') {
          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          fs.writeFileSync(
            OUTPUT_FILE,
            JSON.stringify({
              output: aiResponse,
              sessionId
            }, null, 2)
          );
          console.log('\n✓ Output saved! It will load in the chat interface shortly.');
        } else {
          console.log('\nOutput not sent to chat.');
        }
      }
    }
  }

  if (step > maxSteps) {
    console.log('⚠️ Reached maximum thinking steps limit.');
  }

  console.log('\nTerminal session complete. Press Enter to exit.');
  await question('');
  rl.close();
}

main().catch(console.error);
