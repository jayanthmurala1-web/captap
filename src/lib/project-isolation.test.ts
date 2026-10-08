import { afterAll, beforeAll, expect, test } from "vitest";
import { ForbiddenError, NotFoundError } from "./access";
import {
  appendDeveloperWorkLedger,
  getDocument,
  listDocuments,
} from "./documents";
import {
  addProjectMember,
  createProject,
  getProject,
  listProjectMembers,
  listProjects,
  removeProjectMember,
} from "./projects";
import { fixtures } from "./test-fixtures";

const f = fixtures();

let owner: string;
let dev1: string;
let dev2: string;
let outsider: string;
let orgId: string;
let otherOrgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("project-owner");
  dev1 = await f.user("dev-alice");
  dev2 = await f.user("dev-bob");
  outsider = await f.user("outsider-charlie");

  orgId = await f.org("company-alpha", {
    [owner]: "owner",
    [dev1]: "member",
    [dev2]: "member",
  });

  otherOrgId = await f.org("company-beta", {
    [outsider]: "owner",
  });

  const proj = await createProject(owner, orgId, {
    name: "Secret Project Alpha",
    description: "Confidential R&D project",
  });
  projectId = proj.id;
});

afterAll(() => f.cleanup());

test("Phase 3.3: Project creation auto-provisions project lead and work ledger", async () => {
  // Owner is recorded as lead in projectMember
  const members = await listProjectMembers(owner, projectId);
  expect(members.length).toBe(1);
  expect(members[0].userId).toBe(owner);
  expect(members[0].role).toBe("lead");

  // Daily work ledger was auto-created
  const docs = await listDocuments(owner, projectId, {
    docType: "work_ledger",
  });
  expect(docs.length).toBe(1);
  expect(docs[0].docType).toBe("work_ledger");
  expect(docs[0].title).toContain("developer/");
  expect(docs[0].title).toContain("/work");
});

test("Phase 3.3: Zero-knowledge isolation blocks unassigned org members", async () => {
  // dev1 and dev2 belong to the org, but are NOT assigned to this project
  const dev1Projects = await listProjects(dev1, orgId);
  expect(dev1Projects.find((p) => p.id === projectId)).toBeUndefined();

  // Attempting to query project directly throws NotFoundError (zero-knowledge)
  await expect(getProject(dev1, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );

  // Attempting to list project members throws NotFoundError
  await expect(listProjectMembers(dev1, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("Phase 3.3: Adding developer grants scoped access and auto-provisions daily KT ledger", async () => {
  // Assign dev1 as 'developer'
  const assigned = await addProjectMember(owner, projectId, dev1, "developer");
  expect(assigned).toBeDefined();
  expect(assigned.role).toBe("developer");

  // dev1 can now list and view the project
  const dev1Projects = await listProjects(dev1, orgId);
  expect(dev1Projects.some((p) => p.id === projectId)).toBe(true);

  const fetched = await getProject(dev1, projectId);
  expect(fetched.name).toBe("Secret Project Alpha");

  // dev1's Daily Work & KT Ledger was auto-created
  const docs = await listDocuments(dev1, projectId, {
    docType: "work_ledger",
  });
  const dev1Ledger = docs.find((d) => d.createdBy === dev1);
  expect(dev1Ledger).toBeDefined();
  expect(dev1Ledger?.title).toContain("work");

  // dev1 can append daily KT logs to their ledger
  const updateResult = await appendDeveloperWorkLedger(dev1, projectId, {
    status: "Active Development",
    focusArea: "API contracts and isolation testing",
    architecturalNotes: "Verified zero-knowledge boundary",
    ktHandoff: "Branch checked out into .worktrees/T-1",
  });
  expect(updateResult.version).toBe(2);

  const updatedDoc = await getDocument(dev1, updateResult.documentId);
  expect(updatedDoc.content).toContain("API contracts and isolation testing");
  expect(updatedDoc.content).toContain("Verified zero-knowledge boundary");
});

test("Phase 3.3: Regular member cannot add other members (requires admin or lead)", async () => {
  await expect(
    addProjectMember(dev1, projectId, dev2, "developer"),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("Phase 3.3: Removing member revokes access immediately", async () => {
  // Remove dev1
  await removeProjectMember(owner, projectId, dev1);

  // dev1 can no longer view the project
  const dev1Projects = await listProjects(dev1, orgId);
  expect(dev1Projects.find((p) => p.id === projectId)).toBeUndefined();

  await expect(getProject(dev1, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("Phase 3.3: Outsiders from another org are completely blocked", async () => {
  expect(await listProjects(outsider, orgId)).toEqual([]);
  expect(await listProjects(outsider, otherOrgId)).toEqual([]);

  await expect(getProject(outsider, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(
    addProjectMember(outsider, projectId, outsider, "developer"),
  ).rejects.toBeInstanceOf(NotFoundError);
});
