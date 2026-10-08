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
import { connection } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./access";
import {
  checkConnection,
  createConnection,
  deleteConnection,
  listConnections,
  notifySlack,
  updateConnection,
} from "./connections";
import { ValidationError } from "./errors";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let owner: string;
let dev: string;
let orgA: string;

beforeAll(async () => {
  owner = await f.user("conn-owner");
  dev = await f.user("conn-dev");
  orgA = await f.org("conn-a", { [owner]: "owner", [dev]: "member" });
});

afterAll(() => f.cleanup());

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

test("only an org admin can add a connection, and a bad webhook is rejected before storing", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  await expect(
    createConnection(dev, orgA, {
      kind: "slack_webhook",
      label: "team",
      secret: "https://hooks.slack.com/services/x",
    }),
  ).rejects.toThrow(ForbiddenError);

  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 404,
    text: async () => "no_service",
  });
  await expect(
    createConnection(owner, orgA, {
      kind: "slack_webhook",
      label: "team",
      secret: "https://hooks.slack.com/services/bad",
    }),
  ).rejects.toThrow(ValidationError);
  expect(await listConnections(owner, orgA)).toHaveLength(0);
});

test("a valid slack webhook is stored encrypted and only a hint is ever read back", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  const row = await createConnection(owner, orgA, {
    kind: "slack_webhook",
    label: "team",
    secret: "https://hooks.slack.com/services/T00/B00/XXXXYYYYZZZZ",
  });
  expect(row.secretHint).toBe("ZZZZ");
  const listed = await listConnections(owner, orgA);
  expect(listed.find((c) => c.id === row.id)?.secretHint).toBe("ZZZZ");
});

test("notifySlack posts to EVERY connected channel, not an arbitrary one", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  // orgA already has one Slack connection from the test above; add a second channel.
  await createConnection(owner, orgA, {
    kind: "slack_webhook",
    label: "notify-test",
    secret: "https://hooks.slack.com/services/notify",
  });
  fetchMock.mockClear();
  await notifySlack(orgA, "hello");
  const urls = fetchMock.mock.calls.map((c) => c[0]);
  expect(urls).toContain("https://hooks.slack.com/services/notify");
  expect(urls).toContain(
    "https://hooks.slack.com/services/T00/B00/XXXXYYYYZZZZ",
  );
  expect(urls).toHaveLength(2);
});

test("notifySlack: one dead webhook never blocks the others, and it never throws", async () => {
  fetchMock.mockClear();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/notify")) throw new Error("network down");
    return { ok: true, text: async () => "ok" };
  });
  await expect(notifySlack(orgA, "hello again")).resolves.toBeUndefined();
  const urls = fetchMock.mock.calls.map((c) => c[0]);
  // The healthy channel still got the message even though the other one threw.
  expect(urls).toContain(
    "https://hooks.slack.com/services/T00/B00/XXXXYYYYZZZZ",
  );
});

test("updateConnection: admin-only, re-verifies a rotated secret, keeps the same row", async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  const row = await createConnection(owner, orgA, {
    kind: "github_pat",
    label: "rotate-me",
    secret: "ghp_old1",
  });

  await expect(
    updateConnection(dev, row.id, { secret: "ghp_new2" }),
  ).rejects.toThrow(ForbiddenError);

  // A rotated secret that GitHub rejects is refused and the stored one is untouched.
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: async () => "",
  });
  await expect(
    updateConnection(owner, row.id, { secret: "ghp_bad3" }),
  ).rejects.toThrow(ValidationError);
  expect(
    (await listConnections(owner, orgA)).find((c) => c.id === row.id)
      ?.secretHint,
  ).toBe("old1");

  const updated = await updateConnection(owner, row.id, { secret: "ghp_new2" });
  expect(updated.id).toBe(row.id); // same row, not delete-and-recreate
  expect(updated.secretHint).toBe("new2");
});

test("delete requires org-admin and removes the row", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  const row = await createConnection(owner, orgA, {
    kind: "github_pat",
    label: "verify",
    secret: "ghp_test",
  });
  await expect(deleteConnection(dev, row.id)).rejects.toThrow(ForbiddenError);
  await deleteConnection(owner, row.id);
  await expect(deleteConnection(owner, row.id)).rejects.toThrow(NotFoundError);
});

test("re-checking uses the stored secret, refreshes verifiedAt only on success, and skips Slack", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  const row = await createConnection(owner, orgA, {
    kind: "github_pat",
    label: "recheck",
    secret: "ghp_chk1",
  });
  const longAgo = new Date(Date.now() - 30 * 86_400_000);
  const verifiedAt = async () =>
    (await db.select().from(connection).where(eq(connection.id, row.id)))[0]
      .verifiedAt;
  await db
    .update(connection)
    .set({ verifiedAt: longAgo })
    .where(eq(connection.id, row.id));

  await expect(checkConnection(dev, row.id)).rejects.toThrow(ForbiddenError);

  // A token GitHub now rejects (revoked) fails loudly and the stale date stays honest.
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: async () => "",
  });
  await expect(checkConnection(owner, row.id)).rejects.toThrow(ValidationError);
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
    "Bearer ghp_chk1", // the decrypted stored token, not something the caller supplied
  );
  expect((await verifiedAt())?.getTime()).toBe(longAgo.getTime());

  fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "ok" });
  await checkConnection(owner, row.id);
  expect((await verifiedAt())?.getTime() ?? 0).toBeGreaterThan(
    Date.now() - 60_000,
  );

  // Slack can only be tested by posting to the channel, so a re-check refuses rather than spams.
  fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });
  const slack = await createConnection(owner, orgA, {
    kind: "slack_webhook",
    label: "recheck-slack",
    secret: "https://hooks.slack.com/services/chk",
  });
  fetchMock.mockClear();
  await expect(checkConnection(owner, slack.id)).rejects.toThrow(
    ValidationError,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
