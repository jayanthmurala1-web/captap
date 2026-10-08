import { createHmac, timingSafeEqual } from "node:crypto";
import { appLink } from "./email";
import { ValidationError } from "./errors";

/**
 * Real "Connect with Slack/GitHub" OAuth (spec 023), not a fake button: it only appears when the
 * server has the vendor's client id/secret (the founder registers an OAuth app with each vendor —
 * that step can't be faked or done by Captap itself). Without it, the manual paste form still works.
 */
export function oauthConfigured(kind: "slack" | "github") {
  return kind === "slack"
    ? Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET)
    : Boolean(
        process.env.GITHUB_OAUTH_CLIENT_ID &&
          process.env.GITHUB_OAUTH_CLIENT_SECRET,
      );
}

// Stateless CSRF state: HMAC-signed {orgId, userId, exp}, no server-side storage needed — the
// round trip to Slack/GitHub and back is the only thing carrying it.
function stateSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new ValidationError("Server is missing BETTER_AUTH_SECRET");
  return secret;
}

export function signState(orgId: string, userId: string) {
  const payload = JSON.stringify({
    orgId,
    userId,
    exp: Date.now() + 10 * 60_000,
  });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", stateSecret())
    .update(b64)
    .digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyState(state: string) {
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) throw new ValidationError("Invalid state");
  const expected = createHmac("sha256", stateSecret())
    .update(b64)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ValidationError("Invalid state");
  const payload = JSON.parse(Buffer.from(b64, "base64url").toString()) as {
    orgId: string;
    userId: string;
    exp: number;
  };
  if (payload.exp < Date.now())
    throw new ValidationError("Connection attempt expired, try again");
  return payload;
}

const SLACK_SCOPES = "incoming-webhook";

export function slackAuthorizeUrl(state: string) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set(
    "redirect_uri",
    appLink("/api/connections/slack/callback"),
  );
  url.searchParams.set("state", state);
  return url.toString();
}

/** Slack's `incoming-webhook` scope returns the webhook URL itself from the token exchange —
 * no separate "pick a channel" step needed, the user picks it in Slack's own consent screen. */
export async function exchangeSlackCode(code: string) {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: appLink("/api/connections/slack/callback"),
    }),
  });
  const data = await res.json();
  if (!data.ok || !data.incoming_webhook?.url)
    throw new ValidationError(
      `Slack declined the connection: ${data.error ?? "unknown error"}`,
    );
  return {
    webhookUrl: data.incoming_webhook.url as string,
    label: `#${data.incoming_webhook.channel ?? "slack"}`,
  };
}

export function githubAuthorizeUrl(state: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("scope", "repo");
  url.searchParams.set(
    "redirect_uri",
    appLink("/api/connections/github/callback"),
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGithubCode(code: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
      code,
      redirect_uri: appLink("/api/connections/github/callback"),
    }),
  });
  const data = await res.json();
  if (!data.access_token)
    throw new ValidationError(
      `GitHub declined the connection: ${data.error_description ?? data.error ?? "unknown error"}`,
    );
  const who = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${data.access_token}` },
  }).then((r) => r.json());
  return {
    token: data.access_token as string,
    label: who.login ? `@${who.login}` : "GitHub",
  };
}
