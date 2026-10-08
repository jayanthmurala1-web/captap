import { NextResponse } from "next/server";
import {
  oauthConfigured,
  signState,
  slackAuthorizeUrl,
} from "@/lib/connections-oauth";
import { appLink } from "@/lib/email";
import { requireSession } from "@/lib/session";

export async function GET() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId || !oauthConfigured("slack"))
    return NextResponse.redirect(appLink("/connections"));
  const state = signState(orgId, user.id);
  return NextResponse.redirect(slackAuthorizeUrl(state));
}
