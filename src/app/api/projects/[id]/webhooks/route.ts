import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitResponse } from "@/lib/rate-limit";
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
} from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = await limitResponse("api", session.user.id);
    if (limited) return limited;

    const webhooks = await listWebhookSubscriptions(session.user.id, {
      projectId,
    });
    return NextResponse.json({ webhooks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Forbidden") || message.includes("Access denied")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = await limitResponse("api", session.user.id);
    if (limited) return limited;

    const body = await req.json();
    const { name, url, events, secret, active } = body ?? {};

    if (!name || !url || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "name, url, and a non-empty events array are required." },
        { status: 400 },
      );
    }

    const subscription = await createWebhookSubscription(session.user.id, {
      projectId,
      name,
      url,
      events,
      secret,
      active,
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Forbidden") || message.includes("Access denied")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
