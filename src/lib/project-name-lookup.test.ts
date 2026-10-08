import { afterAll, beforeAll, expect, test } from "vitest";
import { NotFoundError, requireProject } from "./access";
import { ValidationError } from "./errors";
import { createProject } from "./projects";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let me: string;
let orgA: string;
let orgB: string;
let uniqueId: string;

beforeAll(async () => {
  me = await f.user("name-lookup");
  orgA = await f.org("name-a", { [me]: "owner" });
  orgB = await f.org("name-b", { [me]: "owner" });
  uniqueId = (await createProject(me, orgA, { name: "Acme Checkout" })).id;
  await createProject(me, orgA, { name: "Shared Name" });
  await createProject(me, orgB, { name: "Shared Name" });
});
afterAll(() => f.cleanup());

test("a name matches exactly, ignoring case", async () => {
  expect((await requireProject(me, "acme checkout")).projectId).toBe(uniqueId);
  expect((await requireProject(me, "  ACME CHECKOUT ")).projectId).toBe(
    uniqueId,
  );
  await expect(requireProject(me, "Acme")).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("SQL wildcards in a name are literal characters, not a match-anything", async () => {
  // Regression: ILIKE treated "%" and "_" as wildcards, so "%" resolved to an arbitrary project.
  await expect(requireProject(me, "%")).rejects.toBeInstanceOf(NotFoundError);
  await expect(requireProject(me, "Acme_Checkout")).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("a name shared by projects in two of your workspaces is refused, not guessed", async () => {
  await expect(requireProject(me, "Shared Name")).rejects.toBeInstanceOf(
    ValidationError,
  );
});
