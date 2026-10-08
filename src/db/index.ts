import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// Ensure Node.js serverless functions (e.g. Vercel) use the robust ws implementation
// instead of failing with unhandled WebSocket ErrorEvent.
neonConfig.webSocketConstructor = ws;

// Local trial (docker-compose.yml): plain Postgres behind Neon's wsproxy, e.g. "wsproxy:80". Unset on
// Neon and in production, where none of this applies.
if (process.env.NEON_WS_PROXY) {
  const proxy = process.env.NEON_WS_PROXY;
  neonConfig.wsProxy = (host, port) => `${proxy}/v1?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

export const db = drizzle({
  client: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  schema,
});
