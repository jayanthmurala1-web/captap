import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { createDocumentShare, submitApproval } from "./document-share";
import { createDocument } from "./documents";
import {
  clientDecisionEmail,
  invitationEmail,
  sendEmail,
  taskDecisionEmail,
} from "./email";
import { createInvitation } from "./invitations";
import { addProjectMember, createProject } from "./projects";
import { claimTask, createTasks, decideTask, submitTask } from "./tasks";
import { fixtures, validPrd } from "./test-fixtures";

const REAL = "someone@agency-example.io"; // not a reserved domain, so it would really be sent

const calls = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
const body = (i = 0) => JSON.parse(calls()[i][1].body as string);

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "Captap <notifications@example-sender.dev>";
  process.env.BETTER_AUTH_URL = "https://app.captap.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }),
    ),
  );
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  errorLog.mockRestore();
});

test("sends through Resend with the key, sender, recipient, html and text", async () => {
  const r = await sendEmail({
    to: REAL,
    subject: "Hi",
    html: "<p>x</p>",
    text: "x",
  });
  expect(r).toMatchObject({ sent: true, id: "em_1" });
  expect(calls()).toHaveLength(1);
  expect(calls()[0][0]).toBe("https://api.resend.com/emails");
  expect(calls()[0][1].headers.Authorization).toBe("Bearer re_test_key");
  expect(body()).toEqual({
    from: "Captap <notifications@example-sender.dev>",
    to: [REAL],
    subject: "Hi",
    html: "<p>x</p>",
    text: "x",
  });
});

test("never emails reserved or test addresses", async () => {
  for (const to of [
    "a@test.local",
    "a@x.test",
    "a@example.com",
    "a@foo.invalid",
  ]) {
    expect(
      await sendEmail({ to, subject: "s", html: "h", text: "t" }),
    ).toMatchObject({
      sent: false,
    });
  }
  expect(calls()).toHaveLength(0);
});

test("a missing key, an API error and a network error never throw and are logged", async () => {
  delete process.env.RESEND_API_KEY;
  expect(
    await sendEmail({ to: REAL, subject: "s", html: "h", text: "t" }),
  ).toMatchObject({ sent: false });
  expect(calls()).toHaveLength(0);

  process.env.RESEND_API_KEY = "re_test_key";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "bad" }), { status: 422 }),
    ),
  );
  expect(
    await sendEmail({ to: REAL, subject: "s", html: "h", text: "t" }),
  ).toMatchObject({ sent: false });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  expect(
    await sendEmail({ to: REAL, subject: "s", html: "h", text: "t" }),
  ).toMatchObject({ sent: false });
  expect(errorLog).toHaveBeenCalledTimes(3);
});

test("templates escape user-supplied names and notes and link to the app", () => {
  const inv = invitationEmail({
    inviterName: "<script>alert(1)</script>",
    orgName: "Acme & Sons",
    roleName: "QA",
    link: "https://app.captap.test/accept-invitation/abc",
  });
  expect(inv.html).not.toContain("<script>");
  expect(inv.html).toContain("&lt;script&gt;");
  expect(inv.html).toContain("Acme &amp; Sons");
  expect(inv.html).toContain("https://app.captap.test/accept-invitation/abc");
  expect(inv.text).toContain("https://app.captap.test/accept-invitation/abc");

  const sentBack = taskDecisionEmail({
    decision: "rejected",
    taskKey: "T-3",
    taskTitle: "Checkout",
    note: "Fix <b>the</b> total",
    decidedBy: "Sam",
    link: "https://app.captap.test/tasks/1",
  });
  expect(sentBack.subject).toContain("T-3");
  expect(sentBack.html).toContain("Fix &lt;b&gt;the&lt;/b&gt; total");

  const client = clientDecisionEmail({
    decision: "changes_requested",
    clientName: "Cara",
    documentTitle: "Checkout PRD",
    version: 4,
    note: "Add refunds",
    link: "https://app.captap.test/documents/1",
  });
  expect(client.subject).toMatch(/Checkout PRD/);
  expect(client.text).toContain("Add refunds");
  expect(client.text).toContain("v4");
});

// ---- the three events, end to end (fetch is mocked, nothing real is sent) ----

const f = fixtures();
let owner: string;
let submitter: string;
let org: string;
let projectId: string;
const setEmail = (id: string, email: string) =>
  db.update(user).set({ email }).where(eq(user.id, id));

beforeAll(async () => {
  owner = await f.user("mail-owner");
  submitter = await f.user("mail-sub");
  org = await f.org("mail", { [owner]: "owner", [submitter]: "member" });
  projectId = (await createProject(owner, org, { name: "Mail" })).id;
  await addProjectMember(owner, projectId, submitter, "developer");
  await setEmail(owner, "owner@agency-example.io");
  await setEmail(submitter, "dev@agency-example.io");
});
afterAll(() => f.cleanup());

test("an invitation emails the invitee with the accept link and reports whether it was sent", async () => {
  const inv = await createInvitation(owner, org, REAL, "member");
  expect(inv.emailed).toBe(true);
  expect(calls()).toHaveLength(1);
  expect(body().to).toEqual([REAL]);
  expect(body().html).toContain(
    `https://app.captap.test/accept-invitation/${inv.id}`,
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  const second = await createInvitation(
    owner,
    org,
    "two@agency-example.io",
    "member",
  );
  expect(second.emailed).toBe(false); // the invite still exists; the UI tells the owner to copy the link
});

test("approving or sending back emails the person who submitted the work, not the decider", async () => {
  const [a, b] = await createTasks(owner, projectId, [
    { title: "A", role: "developer" },
    { title: "B", role: "developer" },
  ]);
  const evidence = {
    summary: "ok",
    filesChanged: ["a.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
    reviews: [],
  };
  for (const t of [a, b]) {
    await claimTask(submitter, t.id, "agent-1");
    await submitTask(submitter, t.id, "agent-1", evidence);
  }
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockClear();
  await decideTask(owner, a.id, "approved");
  await decideTask(owner, b.id, "rejected", "Handle empty input");
  expect(calls()).toHaveLength(2);
  expect(body(0).to).toEqual(["dev@agency-example.io"]);
  expect(body(0).subject).toMatch(/approved/i);
  expect(body(1).to).toEqual(["dev@agency-example.io"]);
  expect(body(1).html).toContain("Handle empty input");
});

test("a client decision emails the person who made the share link", async () => {
  const doc = await createDocument(owner, projectId, {
    title: "Spec",
    kind: "prd",
    content: validPrd,
  });
  const share = await createDocumentShare(owner, doc.id);
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockClear();
  await submitApproval(share.token, {
    decision: "changes_requested",
    approverName: "Cara Client",
    note: "Please add refunds",
    version: 1,
  });
  expect(calls()).toHaveLength(1);
  expect(body().to).toEqual(["owner@agency-example.io"]);
  expect(body().html).toContain("Cara Client");
  expect(body().html).toContain("Please add refunds");
});

test("a failing email never breaks the action that triggered it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const [t] = await createTasks(owner, projectId, [
    { title: "C", role: "developer" },
  ]);
  await claimTask(submitter, t.id, "agent-1");
  await submitTask(submitter, t.id, "agent-1", {
    summary: "ok",
    filesChanged: ["a.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
    reviews: [],
  });
  await expect(decideTask(owner, t.id, "approved")).resolves.toBeTruthy();
  expect(errorLog).toHaveBeenCalled();
});
