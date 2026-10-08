import { afterAll, beforeAll, expect, test } from "vitest";
import { ForbiddenError } from "./access";
import {
  DEFAULT_ROLE_SKILLS,
  effectiveRoleSkills,
  getEffectiveRoleRoutes,
  listRoleRoutes,
  setRoleRoutes,
} from "./role-routing";
import { createSkill, deleteSkill } from "./skills";
import { fixtures } from "./test-fixtures";

const md = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} skill\n---\nbody`;

const f = fixtures();
let owner: string;
let dev: string;
let orgA: string;

beforeAll(async () => {
  owner = await f.user("route-owner");
  dev = await f.user("route-dev");
  orgA = await f.org("route-a", { [owner]: "owner", [dev]: "member" });
});

afterAll(() => f.cleanup());

test("an org with no configured routes keeps the hardcoded default", async () => {
  expect(await effectiveRoleSkills(orgA, "developer")).toEqual(
    DEFAULT_ROLE_SKILLS.developer,
  );
  expect(await listRoleRoutes(owner, orgA)).toEqual([]);
});

test("effective routing is what the server applies: defaults until the org configures its own", async () => {
  // Regression: the canvas and the MCP tool used to show the raw rows, i.e. NOTHING for an org that
  // had not touched Flow, while the server was quietly applying the defaults.
  const before = await getEffectiveRoleRoutes(owner, orgA);
  expect(before.configured).toBe(false);
  expect(before.routes).toContainEqual({
    role: "developer",
    skillName: "code-review",
  });
  expect(before.routes).toContainEqual({ role: "devops", skillName: "ci-cd" });
  // Someone outside the org cannot read its routing at all.
  await expect(getEffectiveRoleRoutes(dev, "not-my-org")).rejects.toThrow();
});

test("only an org admin can set routes", async () => {
  await expect(
    setRoleRoutes(dev, orgA, [{ role: "developer", skillName: "code-review" }]),
  ).rejects.toThrow(ForbiddenError);
});

test("configuring routes overrides the default, including a deliberately empty role", async () => {
  await setRoleRoutes(owner, orgA, [
    { role: "developer", skillName: "code-review" },
    { role: "developer", skillName: "security-review" },
    // devops is deliberately left with no routes at all.
  ]);
  expect(await effectiveRoleSkills(orgA, "developer")).toEqual([
    "code-review",
    "security-review",
  ]);
  // Once the org has configured anything, an unmentioned role is really empty —
  // not silently falling back to the hardcoded default for that one role.
  expect(await effectiveRoleSkills(orgA, "devops")).toEqual([]);
});

test("saving again replaces the whole set, not merges", async () => {
  await setRoleRoutes(owner, orgA, [{ role: "qa", skillName: "qa-review" }]);
  expect(await effectiveRoleSkills(orgA, "developer")).toEqual([]);
  expect(await effectiveRoleSkills(orgA, "qa")).toEqual(["qa-review"]);
});

test("deleting an org skill removes its routes, except built-in names which just revert to the default", async () => {
  const custom = await createSkill(
    owner,
    { orgId: orgA },
    { source: md("release-notes"), kind: "guide" },
  );
  const builtIn = await createSkill(
    owner,
    { orgId: orgA },
    { source: md("qa-review"), kind: "review" },
  );
  await setRoleRoutes(owner, orgA, [
    { role: "product", skillName: "release-notes" },
    { role: "qa", skillName: "qa-review" },
  ]);

  await deleteSkill(owner, custom.id);
  await deleteSkill(owner, builtIn.id);

  // The custom skill's route is gone: left behind, it would silently re-attach to any later skill
  // that reuses the name, nobody having chosen that. The built-in name keeps its route: the real
  // row is gone but the built-in qa-review still exists and the org still routes QA tasks to it.
  expect(await listRoleRoutes(owner, orgA)).toEqual([
    { role: "qa", skillName: "qa-review" },
  ]);
  expect((await getEffectiveRoleRoutes(owner, orgA)).configured).toBe(true);
});
