import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { type DynamicStructuredTool, tool } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "@/lib/documents";
import { DomainError } from "@/lib/errors";
import { listOrganizations, listProjects } from "@/lib/projects";
import { listRequirements } from "@/lib/requirements";
import { getSkill, listSkills, type Scope } from "@/lib/skills";
import { getProjectStatus } from "@/lib/status";
import { assignTask, createTasks, listMembers, listTasks } from "@/lib/tasks";
import { requireCapability } from "../access";
import { callCostUsd, MAX_OUTPUT_TOKENS } from "./catalog";
import { buildConsultContext, type ConsultToolset } from "./consult-context";
import {
  type ModelAccess,
  recordKeyOutcome,
  resolveModelAccess,
} from "./model-access";
import {
  createChatModel,
  extractUsage,
  friendlyProviderError,
  rateLimitWaitMs,
  scrub,
} from "./providers";
import { recordAgentTelemetry } from "./telemetry";

export interface ChatMessageInput {
  /** The browser can send only these two; the system prompt is built on the server (spec 021). */
  role: "user" | "assistant";
  content: string;
}

export type ConsultEvent =
  | {
      type: "started";
      agent: string;
      provider: string;
      model: string;
      keySource: "org" | "platform";
    }
  | { type: "chunk"; text: string }
  | { type: "tool_start"; tool: string; args: Record<string, unknown> }
  | { type: "tool_end"; tool: string; result: unknown }
  | {
      type: "telemetry";
      tokens: { input: number; output: number; total: number };
      costUsd: string;
      modelName: string;
      provider: string;
      keySource: "org" | "platform";
      /** True when the provider reported no usage and we guessed from text length. */
      estimated: boolean;
    }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * Creates LangChain tools bound to the authenticated user and domain operations.
 */
const READ_TOOLS = new Set([
  "list_projects",
  "get_project_status",
  "list_skills",
  "get_skill",
  "list_documents",
  "get_document",
  "list_tasks",
  "list_requirements",
  "list_members",
]);

/** Reviewer agents get only the reading tools; specialist agents get everything (spec 021). */
export function createProjectTools(
  userId: string,
  toolset: ConsultToolset = "full",
): DynamicStructuredTool[] {
  const all = allTools(userId);
  return toolset === "full" ? all : all.filter((t) => READ_TOOLS.has(t.name));
}

function allTools(userId: string): DynamicStructuredTool[] {
  const safe = async <T>(fn: () => Promise<T>): Promise<string> => {
    try {
      const res = await fn();
      return typeof res === "string" ? res : JSON.stringify(res);
    } catch (err) {
      if (err instanceof DomainError) {
        return JSON.stringify({ error: err.message });
      }
      return JSON.stringify({ error: String(err) });
    }
  };

  const resolveScope = async (projectId?: string): Promise<Scope> => {
    if (projectId) return { projectId };
    const orgs = await listOrganizations(userId);
    if (orgs.length > 0) return { orgId: orgs[0].id };
    throw new DomainError("No organization or project available for skills.");
  };

  return [
    tool(() => safe(() => listProjects(userId)), {
      name: "list_projects",
      description:
        "List all projects across organizations the user belongs to.",
      schema: z.object({}),
    }),
    tool(({ projectId }) => safe(() => getProjectStatus(userId, projectId)), {
      name: "get_project_status",
      description:
        "Get deterministic health and progress status for a project (review queue, blocked tasks, in-progress tasks, and recent changes).",
      schema: z.object({
        projectId: z.string().describe("The UUID of the project"),
      }),
    }),
    tool(
      async ({ projectId, kind }) =>
        safe(async () => {
          const scope = await resolveScope(projectId);
          return await listSkills(
            userId,
            scope,
            kind as "guide" | "review" | undefined,
          );
        }),
      {
        name: "list_skills",
        description:
          "List company (org) or project skills (guide: how to write PRDs or tasks; review: how to evaluate work).",
        schema: z.object({
          projectId: z
            .string()
            .optional()
            .describe("Optional project ID for effective project skills"),
          kind: z
            .enum(["guide", "review"])
            .optional()
            .describe("Filter by skill kind"),
        }),
      },
    ),
    tool(
      async ({ name, projectId }) =>
        safe(async () => {
          const scope = await resolveScope(projectId);
          const s = await getSkill(userId, scope, name);
          return { name: s.name, description: s.description, source: s.source };
        }),
      {
        name: "get_skill",
        description:
          "Get the full markdown instructions of a skill by name (e.g. prd-writing, task-breakdown, code-review).",
        schema: z.object({
          name: z.string().describe("Name of the skill"),
          projectId: z
            .string()
            .optional()
            .describe("Project ID to resolve project skill overrides"),
        }),
      },
    ),
    tool(({ projectId }) => safe(() => listDocuments(userId, projectId)), {
      name: "list_documents",
      description: "List documents (PRDs, specs, meeting notes) for a project.",
      schema: z.object({
        projectId: z.string().describe("The UUID of the project"),
      }),
    }),
    tool(({ documentId }) => safe(() => getDocument(userId, documentId)), {
      name: "get_document",
      description:
        "Get full markdown content and current version of a project document.",
      schema: z.object({
        documentId: z.string().describe("The UUID of the document"),
      }),
    }),
    tool(
      ({ projectId, title, kind, content }) =>
        safe(() =>
          createDocument(userId, projectId, {
            title,
            kind: kind === "doc" ? "doc" : "prd",
            content,
          }),
        ),
      {
        name: "create_document",
        description:
          "Create and save a new PRD or doc in Project OS. Admins only.",
        schema: z.object({
          projectId: z.string().describe("The UUID of the project"),
          title: z.string().describe("Document title"),
          kind: z
            .enum(["prd", "doc"])
            .default("prd")
            .describe("Document kind: 'prd' or 'doc'"),
          content: z.string().describe("Full markdown text of the document"),
        }),
      },
    ),
    tool(
      ({ documentId, title, content, baseVersion }) =>
        safe(() =>
          updateDocument(userId, documentId, {
            title,
            content,
            baseVersion,
          }),
        ),
      {
        name: "update_document",
        description:
          "Update an existing document with optimistic concurrency (baseVersion required). Admins only.",
        schema: z.object({
          documentId: z.string().describe("The UUID of the document"),
          title: z.string().optional().describe("Updated title (optional)"),
          content: z.string().describe("Updated markdown content"),
          baseVersion: z
            .number()
            .describe("The currentVersion previously read"),
        }),
      },
    ),
    tool(
      ({ projectId, status }) =>
        safe(() =>
          listTasks(userId, projectId, status ? { status } : undefined),
        ),
      {
        name: "list_tasks",
        description: "List tasks for a project with optional status filter.",
        schema: z.object({
          projectId: z.string().describe("The UUID of the project"),
          status: z
            .enum(["todo", "in_progress", "in_review", "done"])
            .optional()
            .describe("Optional task status filter"),
        }),
      },
    ),
    tool(
      ({ prdDocumentId }) =>
        safe(() => listRequirements(userId, prdDocumentId)),
      {
        name: "list_requirements",
        description:
          "List a PRD's requirements (R-1, R-2…, one per acceptance criterion) with their state and the tasks that deliver each. Use it to find requirements that still have no work.",
        schema: z.object({
          prdDocumentId: z.string().describe("The UUID of the PRD document"),
        }),
      },
    ),
    tool(
      ({ projectId, tasks }) =>
        safe(() =>
          createTasks(
            userId,
            projectId,
            tasks as Parameters<typeof createTasks>[2],
          ),
        ),
      {
        name: "create_tasks",
        description:
          "Batch create tasks with dependencies for a project. Tie each task to its PRD and the requirement keys (R-1, R-2…) it delivers so the client-approved requirements stay traceable. Needs the manage-tasks permission.",
        schema: z.object({
          projectId: z.string().describe("The UUID of the project"),
          tasks: z
            .array(
              z.object({
                ref: z
                  .string()
                  .describe(
                    "Batch reference (e.g. 'T-1', 'task-backend') to allow other tasks in this batch to depend on it",
                  ),
                title: z.string().describe("Concise task title"),
                description: z
                  .string()
                  .describe("Full task specification and acceptance criteria"),
                role: z
                  .enum(["developer", "devops", "qa", "product"])
                  .describe("Who does it: developer, devops, qa or product"),
                prdDocumentId: z
                  .string()
                  .optional()
                  .describe(
                    "The PRD document this task is built under (from list_documents)",
                  ),
                requirementKeys: z
                  .array(z.string())
                  .optional()
                  .describe(
                    "Keys of that PRD's requirements this task delivers, e.g. ['R-1','R-3'] (from list_requirements)",
                  ),
                dependsOn: z
                  .array(z.string())
                  .optional()
                  .describe(
                    "UUIDs of existing tasks or refs of preceding tasks in this batch",
                  ),
              }),
            )
            .describe("List of tasks to create sequentially"),
        }),
      },
    ),
    tool(
      ({ taskId, assigneeId }) =>
        safe(() => assignTask(userId, taskId, assigneeId ?? null)),
      {
        name: "assign_task",
        description:
          "Assign or unassign a task to a team member by member UUID. Admins only.",
        schema: z.object({
          taskId: z.string().describe("The UUID of the task"),
          assigneeId: z
            .string()
            .nullable()
            .optional()
            .describe("UUID of the team member, or null to unassign"),
        }),
      },
    ),
    tool(({ projectId }) => safe(() => listMembers(userId, projectId)), {
      name: "list_members",
      description: "List members of a project's organization.",
      schema: z.object({
        projectId: z.string().describe("The UUID of the project"),
      }),
    }),
  ];
}

/**
 * LangGraph State Definition
 */
export const ConsultStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});

export type ConsultState = typeof ConsultStateAnnotation.State;

/** The agent <-> tools loop for one consultation, on whichever model `access` resolved. */
export function buildConsultGraph(o: {
  model: BaseChatModel;
  tools: DynamicStructuredTool[];
  access: ModelAccess;
  onEvent?: (event: ConsultEvent) => void;
}) {
  const { access, onEvent } = o;
  const toolsByName = new Map(o.tools.map((t) => [t.name, t]));
  if (!o.model.bindTools)
    throw new Error(`${access.provider} models here cannot use tools`);
  const modelWithTools = o.model.bindTools(o.tools);

  // Agent Node: streams LLM response chunks and produces AIMessage
  const agentNode = async (state: ConsultState) => {
    let fullResponse: AIMessageChunk | null = null;

    // A tool-using consult sends the whole context several times in a row, which can trip a provider's
    // per-minute token limit mid-conversation. The provider says how long to wait: wait and try again
    // (at most twice, only for short waits, and only if nothing has been shown to the person yet).
    for (let attempt = 0; ; attempt++) {
      let shown = false;
      try {
        const stream = await modelWithTools.stream(state.messages);
        for await (const chunk of stream) {
          fullResponse = fullResponse ? fullResponse.concat(chunk) : chunk;
          if (typeof chunk.content === "string" && chunk.content) {
            shown = true;
            onEvent?.({ type: "chunk", text: chunk.content });
          }
        }
        break;
      } catch (err) {
        const wait = rateLimitWaitMs(
          err instanceof Error ? err.message : String(err),
        );
        if (shown || wait === null || wait > 20_000 || attempt >= 2) throw err;
        fullResponse = null;
        await new Promise((r) => setTimeout(r, wait + 500));
      }
    }

    // The provider's own counts; only if it reports none do we estimate (and say so).
    const reported = extractUsage(fullResponse);
    let inputTokens = reported?.input ?? 0;
    let outputTokens = reported?.output ?? 0;

    // Some providers report no usage; then we estimate from text length and say so.
    let estimated = false;
    if (inputTokens === 0 && outputTokens === 0) {
      estimated = true;
      const promptChars = state.messages.reduce(
        (acc, m) =>
          acc + (typeof m.content === "string" ? m.content.length : 0),
        0,
      );
      const responseChars =
        typeof fullResponse?.content === "string"
          ? fullResponse.content.length
          : 0;
      inputTokens = Math.max(10, Math.round(promptChars / 4));
      outputTokens = Math.max(5, Math.round(responseChars / 4));
    }

    onEvent?.({
      type: "telemetry",
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      costUsd: callCostUsd(
        access.provider,
        access.model,
        inputTokens,
        outputTokens,
      ),
      modelName: access.model,
      provider: access.provider,
      keySource: access.keySource,
      estimated,
    });

    return { messages: fullResponse ? [fullResponse] : [] };
  };

  // Tools Node: executes tool calls and appends ToolMessages
  const toolsNode = async (state: ConsultState) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls =
      lastMessage instanceof AIMessage ? lastMessage.tool_calls : undefined;
    if (!toolCalls || toolCalls.length === 0) return { messages: [] };

    const toolMessages: ToolMessage[] = [];

    for (const tc of toolCalls) {
      const selectedTool = toolsByName.get(tc.name);
      const args = (tc.args ?? {}) as Record<string, unknown>;

      onEvent?.({ type: "tool_start", tool: tc.name, args });

      let resultStr = "";
      if (selectedTool) {
        try {
          const rawResult = await (
            selectedTool as DynamicStructuredTool
          ).invoke(args);
          resultStr =
            typeof rawResult === "string"
              ? rawResult
              : JSON.stringify(rawResult);
        } catch (err) {
          resultStr = JSON.stringify({ error: String(err) });
        }
      } else {
        resultStr = JSON.stringify({ error: `Tool not found: ${tc.name}` });
      }

      let parsedResult: unknown;
      try {
        parsedResult = JSON.parse(resultStr);
      } catch {
        parsedResult = resultStr;
      }

      onEvent?.({ type: "tool_end", tool: tc.name, result: parsedResult });

      toolMessages.push(
        new ToolMessage({
          content: resultStr,
          tool_call_id: tc.id ?? `call_${Date.now()}`,
          name: tc.name,
        }),
      );
    }

    return { messages: toolMessages };
  };

  // Conditional Router
  const shouldContinue = (state: ConsultState) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls =
      lastMessage instanceof AIMessage ? lastMessage.tool_calls : undefined;
    return toolCalls && toolCalls.length > 0 ? "tools" : END;
  };

  return new StateGraph(ConsultStateAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, ["tools", END])
    .addEdge("tools", "agent")
    .compile();
}

export type ConsultInput = {
  orgId: string;
  projectId?: string;
  taskId?: string;
  /** Required: Consult has no generic assistant. */
  agentName: string;
  messages: ChatMessageInput[];
  provider?: string;
  model?: string;
};

export type PreparedConsult = Awaited<ReturnType<typeof prepareConsult>>;

/**
 * Everything that can fail for a reason the person can fix (not allowed, unknown agent, no key,
 * allowance used) happens here, BEFORE anything streams, so the caller can answer with a real
 * status code instead of a broken stream.
 */
export async function prepareConsult(userId: string, input: ConsultInput) {
  await requireCapability(userId, input.orgId, "use_ai");
  const context = await buildConsultContext(userId, input);
  const access = await resolveModelAccess(input.orgId, {
    provider: input.provider,
    model: input.model,
  });
  return { userId, input, context, access };
}

/** prepare + run, for callers that don't need to answer before streaming (tests, evals). */
export async function runConsult(
  userId: string,
  input: ConsultInput,
  onEvent?: (event: ConsultEvent) => void,
  signal?: AbortSignal,
) {
  return streamConsult(await prepareConsult(userId, input), onEvent, signal);
}

/** Streams one consultation. Once this starts, failures arrive as an `error` event. */
export async function streamConsult(
  { userId, input, context, access }: PreparedConsult,
  onEvent?: (event: ConsultEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const model = createChatModel({
    provider: access.provider,
    model: access.model,
    apiKey: access.apiKey,
    streaming: true,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const start = Date.now();
  const totals = { input: 0, output: 0 };
  let estimated = false;
  let status: "success" | "error" = "success";
  let failure: string | undefined;

  const emit = (event: ConsultEvent) => {
    if (event.type === "telemetry") {
      totals.input += event.tokens.input;
      totals.output += event.tokens.output;
      estimated ||= event.estimated;
    } else if (event.type === "error") {
      status = "error";
      failure = event.error;
    }
    onEvent?.(event);
  };

  emit({
    type: "started",
    agent: context.agent.name,
    provider: access.provider,
    model: access.model,
    keySource: access.keySource,
  });

  try {
    const graph = buildConsultGraph({
      model,
      tools: createProjectTools(userId, context.toolset),
      access,
      onEvent: emit,
    });
    await graph.invoke(
      {
        messages: [
          new SystemMessage(context.system),
          ...input.messages.map((m) =>
            m.role === "assistant"
              ? new AIMessage(m.content)
              : new HumanMessage(m.content),
          ),
        ],
      },
      { signal, recursionLimit: 10 },
    );
    emit({ type: "done" });
  } catch (err) {
    if (signal?.aborted) {
      emit({ type: "done" });
    } else {
      const message = scrub(
        err instanceof Error ? err.message : String(err),
        access.apiKey,
      );
      console.error("Consult error:", message);
      emit({ type: "error", error: friendlyProviderError(message) });
    }
  } finally {
    try {
      await recordAgentTelemetry({
        orgId: input.orgId,
        projectId: context.projectId,
        taskId: input.taskId,
        userId,
        agentName: context.agent.name,
        modelProvider: access.provider,
        modelName: access.model,
        keySource: access.keySource,
        purpose: "consult",
        inputTokens: totals.input,
        outputTokens: totals.output,
        durationMs: Date.now() - start,
        status,
        errorMessage: failure,
        metadata: estimated ? { estimated: true } : {},
      });
      if (access.keySource === "org")
        await recordKeyOutcome(input.orgId, access.provider, failure);
    } catch (e) {
      // Telemetry must never crash the caller, but a broken meter is worth a loud log.
      console.error("could not record Consult usage:", e);
    }
  }
}
