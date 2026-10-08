import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetDir = resolve(process.cwd(), "..", "test-project");
const agentsDir = resolve(targetDir, ".agents");

console.log(`Setting up test-project at: ${targetDir}`);

if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

if (!existsSync(agentsDir)) {
  mkdirSync(agentsDir, { recursive: true });
}

// 1. Create .agents/mcp_config.json
const bridgeScriptPath = resolve(
  process.cwd(),
  "scripts",
  "mcp-bridge.mjs",
).replace(/\\/g, "/");
const mcpConfig = {
  mcpServers: {
    "project-os": {
      command: "node",
      args: [bridgeScriptPath],
      env: {
        PROJECT_OS_URL: "http://localhost:3000",
      },
    },
  },
};

writeFileSync(
  resolve(agentsDir, "mcp_config.json"),
  JSON.stringify(mcpConfig, null, 2),
  "utf-8",
);

// 2. Create README.md
const readmeContent = `# Test Project (Connected to Project OS)

This is an independent client workspace connected to **Project OS** via the Model Context Protocol (MCP).

## How to use with Antigravity
1. In your **Project OS** terminal, ensure the server is running:
   \`\`\`bash
   pnpm dev
   \`\`\`

2. Log into Project OS (one-time) to generate your access token:
   \`\`\`bash
   node "${bridgeScriptPath}" login <your-email> <your-password>
   \`\`\`

3. Open this folder (\`c:\\Users\\jayan\\Downloads\\test-project\`) in Antigravity.
   Antigravity will automatically discover the Project OS MCP server from \`.agents/mcp_config.json\`!
`;

writeFileSync(resolve(targetDir, "README.md"), readmeContent, "utf-8");

console.log(`✅ test-project created successfully!`);
console.log(`- Path: ${targetDir}`);
console.log(`- MCP Config: ${resolve(agentsDir, "mcp_config.json")}`);
