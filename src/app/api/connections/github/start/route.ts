import { NextResponse } from "next/server";
import {
  githubAuthorizeUrl,
  oauthConfigured,
  signState,
} from "@/lib/connections-oauth";
import { appLink } from "@/lib/email";
import { requireSession } from "@/lib/session";

export async function GET() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId || !oauthConfigured("github"))
    return NextResponse.redirect(appLink("/connections"));
  const state = signState(orgId, user.id);
  return NextResponse.redirect(githubAuthorizeUrl(state));
}
