import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitResponse } from "@/lib/rate-limit";
import { getProjectTelemetry } from "@/lib/telemetry";

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

    const telemetry = await getProjectTelemetry(session.user.id, projectId);
    return NextResponse.json({ telemetry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
