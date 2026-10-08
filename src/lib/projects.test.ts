import { afterAll, beforeAll, expect, test } from "vitest";
import { ForbiddenError } from "./access";
import { createProject, listProjects } from "./projects";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let userA: string;
let orgB: string;

beforeAll(async () => {
  userA = await f.user("ua");
  const userB = await f.user("ub");
  const orgA = await f.org("oa", { [userA]: "owner" });
  orgB = await f.org("ob", { [userB]: "owner" });
  await createProject(userA, orgA, { name: "A secret" });
  await createProject(userB, orgB, { name: "B secret" });
});

afterAll(() => f.cleanup());

test("user sees only their own org's projects", async () => {
  expect((await listProjects(userA)).map((p) => p.name)).toEqual(["A secret"]);
  expect(await listProjects(userA, orgB)).toEqual([]);
});

test("user cannot create a project in another org", async () => {
  await expect(
    createProject(userA, orgB, { name: "intrusion" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
