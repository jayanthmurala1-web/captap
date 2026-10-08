// Applies drizzle/ migrations with the same driver the app uses, so it also works through the local
// wsproxy (drizzle-kit migrate needs a plain `pg` connection, which the trial stack doesn't expose).
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const proxy = process.env.NEON_WS_PROXY;
if (proxy) {
  neonConfig.wsProxy = (host, port) => `${proxy}/v1?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrations applied");
