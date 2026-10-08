import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const TOKEN_FILE = join(ROOT_DIR, ".mcp-token.json");
const BASE_URL = process.env.PROJECT_OS_URL || "http://localhost:3000";

function log(...args) {
  process.stderr.write(`[project-os-mcp] ${args.join(" ")}\n`);
}

/**
 * Perform OAuth 2.0 PKCE login with Project OS Better-Auth backend
 */
async function login(email, password) {
  const cookieJar = new Map();

  function updateCookies(res) {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return;
    for (const cookie of setCookie.split(/,(?=[^;]+=[^;]+)/)) {
      const [pair] = cookie.trim().split(";");
      const [name, ...val] = pair.split("=");
      if (name && val.length) cookieJar.set(name.trim(), val.join("="));
    }
  }

  function getCookieHeader() {
    return Array.from(cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async function post(path, body) {
    const headers = {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    };
    const cookies = getCookieHeader();
    if (cookies) headers.Cookie = cookies;

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    updateCookies(res);
    return res;
  }

  log(`Signing in to ${BASE_URL} as ${email}...`);
  const signInRes = await post("/api/auth/sign-in/email", { email, password });
  if (!signInRes.ok) {
    const text = await signInRes.text();
    throw new Error(`Sign in failed (${signInRes.status}): ${text}`);
  }

  log("Registering MCP OAuth client (DCR)...");
  const regRes = await post("/api/auth/oauth2/register", {
    client_name: "Antigravity Bridge",
    redirect_uris: ["http://localhost:9999/cb"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  });
  if (!regRes.ok) {
    throw new Error(`Client registration failed: ${await regRes.text()}`);
  }
  const regData = await regRes.json();
  const clientId = regData.client_id;

  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const redirectUri = "http://localhost:9999/cb";
  const resource = `${BASE_URL}/api/mcp`;

  const authUrl = new URL(`${BASE_URL}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid offline_access");
  authUrl.searchParams.set("state", "ag");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", resource);

  const authRes = await fetch(authUrl.toString(), {
    method: "GET",
    headers: { Cookie: getCookieHeader() },
    redirect: "manual",
  });
  updateCookies(authRes);

  const location = authRes.headers.get("location") || "";
  const oauthQuery = location.includes("?") ? location.split("?")[1] : location;

  log("Granting OAuth consent...");
  const consentRes = await post("/api/auth/oauth2/consent", {
    accept: true,
    oauth_query: oauthQuery,
  });
  if (!consentRes.ok) {
    throw new Error(`Consent failed: ${await consentRes.text()}`);
  }
  const consentData = await consentRes.json();
  const redirectTarget = consentData.url || location;
  const targetUrl = new URL(redirectTarget, "http://localhost:9999");
  const code = targetUrl.searchParams.get("code");
  if (!code) {
    throw new Error(
      `No authorization code found in response: ${JSON.stringify(consentData)}`,
    );
  }

  log("Exchanging code for access token...");
  const tokenParams = new URLSearchParams();
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("code", code);
  tokenParams.set("redirect_uri", redirectUri);
  tokenParams.set("client_id", clientId);
  tokenParams.set("code_verifier", verifier);
  tokenParams.set("resource", resource);

  const tokenRes = await fetch(`${BASE_URL}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new Error("No access_token returned by token endpoint");
  }

  writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      { accessToken, email, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  log(`Authentication successful! Access token cached to ${TOKEN_FILE}`);
  return accessToken;
}

function getStoredToken() {
  if (process.env.PROJECT_OS_TOKEN) return process.env.PROJECT_OS_TOKEN;
  if (existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
      return data.accessToken;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Forward JSON-RPC requests from stdio to the Project OS /api/mcp endpoint
 */
async function startBridge() {
  const token = getStoredToken();
  if (!token) {
    log(
      "Warning: No token found. Please run 'node scripts/mcp-bridge.mjs login <email> <password>' first.",
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch (_err) {
      log("Malformed input:", line);
      return;
    }

    try {
      const currentToken = getStoredToken();
      const res = await fetch(`${BASE_URL}/api/mcp`, {
        method: "POST",
        headers: {
          Authorization: currentToken ? `Bearer ${currentToken}` : "",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify(req),
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (req.id !== undefined) {
          const errResp = {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: res.status === 401 ? -32001 : -32603,
              message: `Project OS HTTP ${res.status}: ${errorText}`,
            },
          };
          process.stdout.write(`${JSON.stringify(errResp)}\n`);
        }
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const text = await res.text();
        for (const rawLine of text.split("\n")) {
          if (rawLine.startsWith("data: ")) {
            const data = rawLine.slice(6).trim();
            if (data) process.stdout.write(`${data}\n`);
          }
        }
      } else {
        const json = await res.json();
        process.stdout.write(`${JSON.stringify(json)}\n`);
      }
    } catch (err) {
      log("Fetch error:", err.message);
      if (req && req.id !== undefined) {
        const errResp = {
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32000,
            message: `Could not reach Project OS at ${BASE_URL}. Is the server running? (${err.message})`,
          },
        };
        process.stdout.write(`${JSON.stringify(errResp)}\n`);
      }
    }
  });

  log(`Bridge active for ${BASE_URL}/api/mcp`);
}

const [cmd, arg1, arg2] = process.argv.slice(2);
if (cmd === "login") {
  if (!arg1 || !arg2) {
    console.error(
      "Usage: node scripts/mcp-bridge.mjs login <email> <password>",
    );
    process.exit(1);
  }
  login(arg1, arg2).catch((e) => {
    console.error("Login failed:", e);
    process.exit(1);
  });
} else {
  startBridge();
}
