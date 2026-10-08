import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitResponse } from "@/lib/rate-limit";
import { computeTasksHash, listTasks } from "@/lib/tasks";

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

    const tasks = await listTasks(session.user.id, projectId);
    const hash = computeTasksHash(tasks);

    const clientEtag = req.headers.get("if-none-match");
    if (clientEtag && clientEtag === hash) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: hash,
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    return NextResponse.json(
      {
        projectId,
        tasks,
        hash,
        timestamp: Date.now(),
      },
      {
        headers: {
          ETag: hash,
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
