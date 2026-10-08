import { NextResponse } from "next/server";
import { storeOAuthConnection } from "@/lib/connections";
import { exchangeGithubCode, verifyState } from "@/lib/connections-oauth";
import { appLink } from "@/lib/email";
import { DomainError } from "@/lib/errors";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  try {
    if (err) throw new DomainError(`GitHub: ${err}`);
    if (!code || !state) throw new DomainError("Missing code or state");
    const { orgId, userId } = verifyState(state);
    const { token, label } = await exchangeGithubCode(code);
    await storeOAuthConnection(userId, orgId, {
      kind: "github_pat",
      label,
      secret: token,
    });
    return NextResponse.redirect(appLink("/connections?connected=github"));
  } catch (e) {
    const message = e instanceof DomainError ? e.message : "Connection failed";
    return NextResponse.redirect(
      appLink(`/connections?error=${encodeURIComponent(message)}`),
    );
  }
}
