import { describe, expect, it } from "vitest";
import { buildConsultGraph, createProjectTools } from "./consult";

describe("Consult tools and graph", () => {
  const testUserId = "test-user-id";

  it("full agents get every domain tool", () => {
    const names = createProjectTools(testUserId, "full").map((t) => t.name);
    for (const n of [
      "list_projects",
      "list_requirements",
      "get_project_status",
      "list_skills",
      "get_skill",
      "list_documents",
      "get_document",
      "create_document",
      "update_document",
      "list_tasks",
      "create_tasks",
      "assign_task",
      "list_members",
    ])
      expect(names).toContain(n);
  });

  it("reviewer agents get only the reading tools, and no tool can approve", () => {
    const names = createProjectTools(testUserId, "read").map((t) => t.name);
    expect(names.sort()).toEqual([
      "get_document",
      "get_project_status",
      "get_skill",
      "list_documents",
      "list_members",
      "list_projects",
      "list_requirements",
      "list_skills",
      "list_tasks",
    ]);
    const all = createProjectTools(testUserId, "full").map((t) => t.name);
    expect(all.some((n) => /approve|decide|reject/i.test(n))).toBe(false);
  });

  it("compiles the LangGraph StateGraph", () => {
    const tools = createProjectTools(testUserId, "read");
    const model = { bindTools: () => ({ stream: async () => [] }) } as never;
    const graph = buildConsultGraph({
      model,
      tools,
      access: {
        provider: "groq",
        model: "m",
        apiKey: "k",
        keySource: "platform",
      },
    });
    expect(typeof graph.invoke).toBe("function");
  });

  it("handles tool errors gracefully without throwing unhandled exceptions", async () => {
    const tool = createProjectTools(testUserId, "full").find(
      (t) => t.name === "get_project_status",
    );
    if (!tool) throw new Error("tool not found");
    const parsed = JSON.parse(await tool.invoke({ projectId: "invalid-uuid" }));
    expect(parsed).toHaveProperty("error");
  });
});
