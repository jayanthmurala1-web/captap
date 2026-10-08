import { type NextRequest, NextResponse } from "next/server";
import { requireProject } from "@/lib/access";
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
    const { id: rawProjectId } = await params;
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = await limitResponse("stream", session.user.id);
    if (limited) return limited;

    const { projectId } = await requireProject(session.user.id, rawProjectId);

    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        let timer: NodeJS.Timeout | null = null;
        let pingTimer: NodeJS.Timeout | null = null;
        let timeoutTimer: NodeJS.Timeout | null = null;

        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          if (timer) clearInterval(timer);
          if (pingTimer) clearInterval(pingTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };

        req.signal.addEventListener("abort", cleanup);

        try {
          // Send initial snapshot
          const initialTasks = await listTasks(session.user.id, projectId);
          let currentHash = computeTasksHash(initialTasks);

          controller.enqueue(
            encoder.encode(
              `event: init\ndata: ${JSON.stringify({ tasks: initialTasks, hash: currentHash })}\n\n`,
            ),
          );

          // Check for task changes every 2.5s
          timer = setInterval(async () => {
            if (isClosed || req.signal.aborted) {
              cleanup();
              return;
            }

            try {
              const latestTasks = await listTasks(session.user.id, projectId);
              const latestHash = computeTasksHash(latestTasks);

              if (latestHash !== currentHash) {
                currentHash = latestHash;
                if (!isClosed) {
                  controller.enqueue(
                    encoder.encode(
                      `event: update\ndata: ${JSON.stringify({ tasks: latestTasks, hash: latestHash })}\n\n`,
                    ),
                  );
                }
              }
            } catch (err) {
              console.error("Error in task stream poll:", err);
            }
          }, 2500);

          // Heartbeat ping every 15s to keep proxies from closing connection
          pingTimer = setInterval(() => {
            if (isClosed || req.signal.aborted) {
              cleanup();
              return;
            }
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              cleanup();
            }
          }, 15000);

          // Cycle stream every 40s to prevent serverless execution timeouts.
          // EventSource will automatically reconnect cleanly.
          timeoutTimer = setTimeout(() => {
            if (!isClosed) {
              try {
                controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
              } catch {}
              cleanup();
            }
          }, 40000);
        } catch (err) {
          if (!isClosed) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`,
              ),
            );
            cleanup();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
