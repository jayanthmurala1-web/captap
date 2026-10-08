import { requireMember, requireProject } from "../access";
import { ValidationError } from "../errors";
import {
  availableAgents,
  listLearnedRules,
  resolveAgent,
  type Scope,
} from "../skills";
import { getTask } from "../tasks";

/**
 * What choosing an agent changes in Consult (spec 021). The mechanism is the one the MCP bundle and
 * the persona reviews already use: the agent's SKILL.md is the system prompt, its learned rules ride
 * along, and task context comes from the task itself. The prompt is built here, on the server; nothing
 * the browser sends can write to it.
 */
export type ConsultToolset = "read" | "full";

const MAX_PLAYBOOK_CHARS = 60_000;

const FRAME_INTRO = (name: string) =>
  `You are the "${name}" agent in Captap, a tool where software agencies get client-approved requirements, hand tasks to AI agents and approve the results. A member of the agency is consulting you. Stay in the role your playbook below defines.`;

const FRAME_RULES = (toolset: ConsultToolset) => `Rules:
- Only state things you got from a tool result or from the context below. Never claim to have created, changed or checked something unless a tool call did it. Do not describe features Captap does not have (for example, tasks have no comment threads).
- You cannot approve or send back work; people do that on the task page, next to the evidence.
- ${
  toolset === "read"
    ? "You are a reviewer: your tools only read. If the person wants something created or changed, tell them what to change, or name the agent that can do it."
    : "You can read project data and also create or update documents, create tasks and assign them. Do that when asked, then summarise what you did with IDs."
}
- If the request is outside what your playbook is for, say so in one line and name the better agent from the list below. Do not do the other agent's job.
- Be concise and specific.`;

export async function buildConsultContext(
  userId: string,
  input: {
    orgId: string;
    projectId?: string;
    taskId?: string;
    agentName: string;
  },
) {
  // Resolve the project (from the task if that is all we were given) and prove the caller can see it.
  let projectId = input.projectId;
  const task = input.taskId ? await getTask(userId, input.taskId) : null;
  if (task) {
    if (projectId && projectId !== task.projectId)
      throw new ValidationError("That task is not in this project");
    projectId = task.projectId;
  }
  let scope: Scope;
  if (projectId) {
    const p = await requireProject(userId, projectId);
    if (p.orgId !== input.orgId)
      throw new ValidationError("That project is not in this workspace");
    scope = { projectId: p.projectId };
    projectId = p.projectId;
  } else {
    await requireMember(userId, input.orgId);
    scope = { orgId: input.orgId };
  }

  const agent = await resolveAgent(userId, scope, input.agentName);
  const toolset: ConsultToolset = agent.kind === "review" ? "read" : "full";

  const others = (await availableAgents(userId, scope))
    .filter((a) => a.name !== agent.name)
    .map(
      (a) =>
        `- ${a.name} (${a.kind === "review" ? "reviewer" : "specialist"}): ${a.description}`,
    )
    .join("\n");

  let playbook = agent.source;
  let truncated = "";
  if (playbook.length > MAX_PLAYBOOK_CHARS) {
    playbook = playbook.slice(0, MAX_PLAYBOOK_CHARS);
    truncated =
      "\n[The playbook was truncated here because it is longer than 60 KB.]";
  }

  const rules = projectId
    ? (await listLearnedRules(userId, projectId, agent.name)).map(
        (r) => `- ${r.rule}`,
      )
    : [];

  const parts = [
    FRAME_INTRO(agent.name),
    FRAME_RULES(toolset),
    `=== AGENT PLAYBOOK: ${agent.name} ===\n${playbook}${truncated}\n===========================================`,
  ];
  if (rules.length)
    parts.push(
      `Rules this workspace has taught you from work that was sent back (follow them):\n${rules.join("\n")}`,
    );
  if (task) {
    const reqs = task.requirements
      .filter((r) => !r.removed)
      .map((r) => `- ${r.key}: ${r.text}`)
      .join("\n");
    parts.push(
      [
        `The person is looking at task ${task.key}: "${task.title}" (${task.role}, status ${task.status}).`,
        task.description ? `Task description:\n${task.description}` : "",
        task.prd
          ? `It is built under the PRD "${task.prd.title}" (document ${task.prd.id}).`
          : "",
        reqs ? `It delivers these client-approved requirements:\n${reqs}` : "",
        task.dependencies.length
          ? `Depends on: ${task.dependencies.map((d) => `${d.key} (${d.status})`).join(", ")}`
          : "",
        task.reviewNote
          ? `Last note from the reviewer: ${task.reviewNote}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  parts.push(`Other agents in this workspace:\n${others || "(none)"}`);
  if (projectId)
    parts.push(
      `Current active project ID: "${projectId}". Unless specified otherwise, use this projectId for tool calls.`,
    );

  return {
    system: parts.join("\n\n"),
    agent: {
      name: agent.name,
      kind: agent.kind,
      description: agent.description,
    },
    toolset,
    projectId,
    /** The agent a person assigned to the task, else the one their task role points to. */
    defaultAgent: task
      ? (task.assignedSkill ?? task.matchedSkills[0]?.name ?? null)
      : null,
  };
}
