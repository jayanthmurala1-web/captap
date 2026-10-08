import { NextResponse } from "next/server";
import { storeOAuthConnection } from "@/lib/connections";
import { exchangeSlackCode, verifyState } from "@/lib/connections-oauth";
import { appLink } from "@/lib/email";
import { DomainError } from "@/lib/errors";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  try {
    if (err) throw new DomainError(`Slack: ${err}`);
    if (!code || !state) throw new DomainError("Missing code or state");
    const { orgId, userId } = verifyState(state);
    const { webhookUrl, label } = await exchangeSlackCode(code);
    await storeOAuthConnection(userId, orgId, {
      kind: "slack_webhook",
      label,
      secret: webhookUrl,
    });
    return NextResponse.redirect(appLink("/connections?connected=slack"));
  } catch (e) {
    const message = e instanceof DomainError ? e.message : "Connection failed";
    return NextResponse.redirect(
      appLink(`/connections?error=${encodeURIComponent(message)}`),
    );
  }
}
