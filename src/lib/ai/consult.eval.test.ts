import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createDocument } from "../documents";
import { createProject } from "../projects";
import { distillLearningFromCritique } from "../skills";
import { fixtures, validPrd } from "../test-fixtures";
import { type ConsultEvent, runConsult } from "./consult";

/**
 * Eval set for Consult's agent routing (spec 021; project rule: LLM features get evals before the prompt
 * is final). Live model calls, graded by simple deterministic checks. Skipped without a key.
 */
const live = Boolean(process.env.GROQ_API_KEY);
const f = fixtures();
let me: string;
let org: string;
let projectId: string;
let prdId: string;

// Normalize the odd hyphens models emit ("Non\u2011goals") before grading; the check is on content, not typography.
const plain = (s: string) => s.replace(/[\u2010-\u2015\u2212]/g, "-");

// Groq's on-demand tier allows ~8k tokens/minute per model; one Consult request is ~4k. Pace the calls.
const pace = () => new Promise((r) => setTimeout(r, 25_000));

async function consult(
  agentName: string,
  message: string,
  extra: { projectId?: string } = { projectId },
) {
  const events: ConsultEvent[] = [];
  await runConsult(
    me,
    {
      orgId: org,
      agentName,
      messages: [{ role: "user", content: message }],
      ...extra,
    },
    (e) => events.push(e),
  );
  const errors = events.filter((e) => e.type === "error");
  expect(errors, JSON.stringify(errors)).toHaveLength(0);
  const text = plain(
    events.map((e) => (e.type === "chunk" ? e.text : "")).join(""),
  );
  const tools = events.flatMap((e) => (e.type === "tool_start" ? [e] : []));
  return { text, tools, events };
}

describe.skipIf(!live)("Consult evals (live model)", () => {
  beforeAll(async () => {
    delete process.env.CAPTAP_CLOUD; // self-hosted path: the instance's own Groq key
    me = await f.user("eval-me");
    org = await f.org("eval", { [me]: "owner" });
    projectId = (await createProject(me, org, { name: "Eval Co" })).id;
    prdId = (
      await createDocument(me, projectId, {
        title: "Booking PRD",
        kind: "prd",
        content: validPrd.replace(
          "- Given a user signs up",
          "- Customer can book a slot\n- Customer can cancel a booking\n- Given a user signs up",
        ),
      })
    ).id;
    await distillLearningFromCritique(me, {
      projectId,
      rule: "Every PRD you write must end with a section titled 'Rollback Plan'.",
      skillName: "prd-writing",
      source: "human_critique",
    });
  });
  afterAll(() => f.cleanup());
  beforeEach(pace);

  test("1. prd-writing drafts a PRD in the playbook's structure", async () => {
    const { text } = await consult(
      "prd-writing",
      "Draft a PRD for a booking form. Don't ask questions, just write it.",
    );
    expect(text).toMatch(/problem/i);
    expect(text).toMatch(/non-?goals/i);
    expect(text).toMatch(/acceptance criteria/i);
  }, 120_000);

  test("2. qa-review asked the same thing stays in role and hands off", async () => {
    const { text } = await consult(
      "qa-review",
      "Draft a PRD for a booking form. Don't ask questions, just write it.",
    );
    const looksLikePrd =
      /non-?goals/i.test(text) && /acceptance criteria/i.test(text);
    expect(looksLikePrd).toBe(false);
    expect(text).toMatch(/prd-writing/i);
  }, 120_000);

  test("3. a reviewer agent never calls a write tool", async () => {
    const { tools } = await consult(
      "code-review",
      `Create a task called "Fix login" in project ${projectId}.`,
    );
    expect(tools.map((t) => t.tool)).not.toContain("create_tasks");
    expect(tools.map((t) => t.tool)).not.toContain("create_document");
  }, 120_000);

  test("4. task-breakdown ties the tasks it creates to the PRD's requirements", async () => {
    const { tools } = await consult(
      "task-breakdown",
      `Read the PRD "Booking PRD" (document ${prdId}) and its requirements, then create the tasks for it now in this project. Link each task to the requirement it delivers.`,
    );
    const create = tools.find((t) => t.tool === "create_tasks");
    expect(create, "did not call create_tasks").toBeDefined();
    const tasks = (create?.args.tasks ?? []) as {
      requirementKeys?: string[];
      prdDocumentId?: string;
    }[];
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.prdDocumentId).toBe(prdId);
      expect(t.requirementKeys?.length ?? 0).toBeGreaterThan(0);
    }
  }, 180_000);

  test("5. a learned rule attached to the agent shows up in what it writes", async () => {
    const { text } = await consult(
      "prd-writing",
      "Draft a short PRD for a newsletter signup form. Don't ask questions.",
    );
    expect(text).toMatch(/rollback plan/i);
  }, 120_000);

  test("6. it does not describe features Captap doesn't have", async () => {
    const { text } = await consult(
      "prd-writing",
      "What can I do on a single task in Captap? List every action.",
    );
    expect(text).not.toMatch(/comment/i);
  }, 120_000);
});
