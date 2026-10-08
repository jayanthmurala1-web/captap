import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  document,
  project,
  projectLearnedRule,
  roleSkillRoute,
  skill,
  task,
} from "@/db/schema";
import {
  isUuid,
  NotFoundError,
  requireCapability,
  requireMember,
  requireProject,
  requireProjectCapability,
} from "./access";
import { DEFAULT_SKILLS } from "./default-skills";
import { ConflictError, isUniqueViolation, ValidationError } from "./errors";
import { effectiveRoleSkills } from "./role-routing";
import { parseSkill } from "./skill-parser";

export type SkillKind = (typeof skill.$inferSelect)["kind"];
export type Scope = { orgId: string } | { projectId: string };

/** Resolves a scope to its org after checking membership. */
async function resolve(userId: string, scope: Scope) {
  if ("projectId" in scope) {
    const { orgId } = await requireProject(userId, scope.projectId);
    return { orgId, projectId: scope.projectId };
  }
  await requireMember(userId, scope.orgId);
  return { orgId: scope.orgId, projectId: null };
}

/** Org-level skills need manage_org_settings; project-level skills need manage_tasks in that
 * project (same capability that governs the rest of how a project's work gets configured) —
 * membership alone used to be enough, which let any project member rewrite the agent playbooks
 * governing review/task-breakdown for that project. */
async function assertCanWrite(
  userId: string,
  orgId: string,
  projectId: string | null,
) {
  if (!projectId) {
    await requireCapability(userId, orgId, "manage_org_settings");
  } else {
    await requireProjectCapability(userId, projectId, "manage_tasks");
  }
}

/** Effective skills: org skills overlaid by same-named project skills. Includes source. */
export async function getEffectiveSkills(userId: string, scope: Scope) {
  const { orgId, projectId } = await resolve(userId, scope);
  const rows = await db
    .select()
    .from(skill)
    .where(
      and(
        eq(skill.orgId, orgId),
        projectId
          ? or(isNull(skill.projectId), eq(skill.projectId, projectId))
          : isNull(skill.projectId),
      ),
    )
    .orderBy(asc(skill.name));
  const byName = new Map<string, (typeof rows)[number]>();
  for (const r of rows)
    if (!byName.has(r.name) || r.projectId) byName.set(r.name, r);
  return [...byName.values()];
}

/**
 * Every agent a scope can use: org skills overlaid by project skills, plus the built-in defaults for
 * names nobody has customized. Shared by task matching, the agent pickers and Consult (spec 021).
 */
export async function availableAgents(userId: string, scope: Scope) {
  const { orgId } = await resolve(userId, scope);
  const agents = [...(await getEffectiveSkills(userId, scope))];
  for (const def of DEFAULT_SKILLS) {
    const parsed = parseSkill(def.source);
    if (!agents.some((s) => s.name === parsed.name)) {
      agents.push({
        id: `default-${parsed.name}`,
        orgId,
        projectId: null,
        name: parsed.name,
        description: parsed.description,
        kind: def.kind,
        source: def.source,
        updatedBy: "system",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
  return agents;
}

/** One agent by name, or NotFoundError. There is deliberately no generic fallback. */
export async function resolveAgent(userId: string, scope: Scope, name: string) {
  const found = (await availableAgents(userId, scope)).find(
    (a) => a.name === name,
  );
  if (!found) throw new NotFoundError(`No agent named "${name}"`);
  return found;
}

export async function listSkills(
  userId: string,
  scope: Scope,
  kind?: SkillKind,
) {
  return (await getEffectiveSkills(userId, scope))
    .filter((s) => !kind || s.kind === kind)
    .map(({ id, name, description, kind, projectId, updatedAt }) => ({
      id,
      name,
      description,
      kind,
      scope: projectId ? ("project" as const) : ("org" as const),
      updatedAt,
    }));
}

export async function getSkill(userId: string, scope: Scope, name: string) {
  const found = (await getEffectiveSkills(userId, scope)).find(
    (s) => s.name === name,
  );
  if (!found) throw new NotFoundError(`Skill "${name}" not found`);
  return found;
}

export async function getSkillById(userId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Skill not found");
  const [row] = await db.select().from(skill).where(eq(skill.id, id));
  if (!row) throw new NotFoundError("Skill not found");
  await requireMember(userId, row.orgId);
  return row;
}

// The raw writers carry NO permission check — only call them after the caller's own authority
// has been established. The public createSkill/updateSkill below add the capability gate for a
// person editing a skill directly; the learning flywheel (distillLearningFromCritique) calls these
// directly because it appends one bullet as a side-effect of a decision the person was already
// authorized to make (rejecting work), not as an edit of the playbook.
function insertSkillRow(
  userId: string,
  orgId: string,
  projectId: string | null,
  input: { source: string; kind: SkillKind },
) {
  const parsed = parseSkill(input.source);
  return unique(
    db
      .insert(skill)
      .values({
        orgId,
        projectId,
        kind: input.kind,
        updatedBy: userId,
        ...parsed,
      })
      .returning(),
  );
}

function updateSkillRow(
  userId: string,
  id: string,
  input: { source: string; kind: SkillKind },
) {
  const parsed = parseSkill(input.source);
  return unique(
    db
      .update(skill)
      .set({ kind: input.kind, updatedBy: userId, ...parsed })
      .where(eq(skill.id, id))
      .returning(),
  );
}

export async function createSkill(
  userId: string,
  scope: Scope,
  input: { source: string; kind: SkillKind },
) {
  const { orgId, projectId } = await resolve(userId, scope);
  await assertCanWrite(userId, orgId, projectId);
  return insertSkillRow(userId, orgId, projectId, input);
}

export async function updateSkill(
  userId: string,
  id: string,
  input: { source: string; kind: SkillKind },
) {
  const row = await getSkillById(userId, id);
  await assertCanWrite(userId, row.orgId, row.projectId);
  return updateSkillRow(userId, id, input);
}

export async function deleteSkill(userId: string, id: string) {
  const row = await getSkillById(userId, id);
  await assertCanWrite(userId, row.orgId, row.projectId);
  const builtIn = DEFAULT_SKILLS.some(
    (d) => parseSkill(d.source).name === row.name,
  );
  await db.transaction(async (tx) => {
    await tx.delete(skill).where(eq(skill.id, id));
    // An org-level skill's Flow routes die with it — a route is just a skill *name*, so a leftover
    // would silently re-attach itself to any same-named skill created later, nobody having chosen
    // that. Exception: a built-in name (e.g. code-review). Deleting its real row just reverts the
    // org to the built-in default, which that route still legitimately points at.
    if (row.projectId === null && !builtIn) {
      await tx
        .delete(roleSkillRoute)
        .where(
          and(
            eq(roleSkillRoute.orgId, row.orgId),
            eq(roleSkillRoute.skillName, row.name),
          ),
        );
    }
  });
  return row;
}

/** Called once when an org is created. Idempotent so a retried hook can't duplicate rows. */
export async function seedDefaultSkills(orgId: string, userId: string) {
  await db
    .insert(skill)
    .values(
      DEFAULT_SKILLS.map((d) => ({
        orgId,
        kind: d.kind,
        updatedBy: userId,
        ...parseSkill(d.source),
      })),
    )
    .onConflictDoNothing();
}

async function unique<T>(query: Promise<T[]>) {
  try {
    const [row] = await query;
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        "A skill with this name already exists in this scope",
      );
    }
    throw e;
  }
}

// ============================================================================
// Phase 3.4: Vectorized Company Skills & Continuous Learning Flywheel
// ============================================================================

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "having",
  "he",
  "he'd",
  "he'll",
  "he's",
  "her",
  "here",
  "here's",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "how's",
  "i",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "let's",
  "me",
  "more",
  "most",
  "mustn't",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "shan't",
  "she",
  "she'd",
  "she'll",
  "she's",
  "should",
  "shouldn't",
  "so",
  "some",
  "such",
  "than",
  "that",
  "that's",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "there's",
  "these",
  "they",
  "they'd",
  "they'll",
  "they're",
  "they've",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn't",
  "we",
  "we'd",
  "we'll",
  "we're",
  "we've",
  "were",
  "weren't",
  "what",
  "what's",
  "when",
  "when's",
  "where",
  "where's",
  "which",
  "while",
  "who",
  "who's",
  "whom",
  "why",
  "why's",
  "with",
  "won't",
  "would",
  "wouldn't",
  "you",
  "you'd",
  "you'll",
  "you're",
  "you've",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "please",
  "make",
  "sure",
  "need",
  "needs",
  "task",
]);

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words));
}

export type DistillLearningInput = {
  projectId: string;
  rule: string;
  skillName?: string;
  source?: "human_critique" | "persona_review" | "manual";
  sourceTaskId?: string;
  keywords?: string[];
};

/**
 * Distills human critique or persona review failure into a persistent institutional rule.
 * 1. Inserts into projectLearnedRule.
 * 2. Enriches or creates project-level skill override under '## 🧠 Continuous Learnings & Gotchas'.
 */
export async function distillLearningFromCritique(
  userId: string,
  input: DistillLearningInput,
) {
  const { orgId } = await requireProject(userId, input.projectId);
  const targetSkillName = input.skillName?.trim() || "code-review";
  const cleanRule = input.rule.trim();
  if (!cleanRule) throw new ValidationError("Learned rule cannot be empty");

  const keywords = input.keywords?.length
    ? input.keywords
    : extractKeywords(cleanRule);

  const [createdRule] = await db
    .insert(projectLearnedRule)
    .values({
      orgId,
      projectId: input.projectId,
      skillName: targetSkillName,
      rule: cleanRule,
      source: input.source ?? "human_critique",
      sourceTaskId: input.sourceTaskId,
      keywords,
      createdBy: userId,
    })
    .returning();

  // Continuous Learning Flywheel: Enrich project-level skill markdown
  try {
    const existingSkills = await getEffectiveSkills(userId, {
      projectId: input.projectId,
    });
    const targetSkill =
      existingSkills.find((s) => s.name === targetSkillName) ||
      DEFAULT_SKILLS.find((d) => d.source.includes(`name: ${targetSkillName}`));

    if (targetSkill) {
      const isProjectOverride =
        "projectId" in targetSkill && targetSkill.projectId === input.projectId;
      let newSource = targetSkill.source;
      const learnedSectionHeader = "## 🧠 Continuous Learnings & Gotchas";
      const ruleBullet = `- ⚠️ **Rule**: ${cleanRule}\n`;

      if (newSource.includes(learnedSectionHeader)) {
        if (!newSource.includes(cleanRule)) {
          newSource = newSource.replace(
            learnedSectionHeader,
            `${learnedSectionHeader}\n${ruleBullet}`,
          );
        }
      } else {
        newSource = `${newSource.trim()}\n\n${learnedSectionHeader}\n${ruleBullet}`;
      }

      // Raw writers on purpose (see insertSkillRow): the caller was already authorized by
      // requireProject above plus the decision that triggered this; going through createSkill/
      // updateSkill would demand manage_tasks and silently drop the lesson for a QA reviewer.
      if (isProjectOverride && "id" in targetSkill) {
        await updateSkillRow(userId, targetSkill.id as string, {
          source: newSource,
          kind: targetSkill.kind,
        });
      } else {
        await insertSkillRow(userId, orgId, input.projectId, {
          source: newSource,
          kind: targetSkill.kind,
        });
      }
    }
  } catch (err) {
    console.warn("Could not update skill markdown with learned rule:", err);
  }

  return createdRule;
}

export async function listLearnedRules(
  userId: string,
  projectId: string,
  skillName?: string,
) {
  await requireProject(userId, projectId);
  const rows = await db
    .select({
      id: projectLearnedRule.id,
      orgId: projectLearnedRule.orgId,
      projectId: projectLearnedRule.projectId,
      skillName: projectLearnedRule.skillName,
      rule: projectLearnedRule.rule,
      source: projectLearnedRule.source,
      sourceTaskId: projectLearnedRule.sourceTaskId,
      keywords: projectLearnedRule.keywords,
      createdAt: projectLearnedRule.createdAt,
      taskNumber: task.number,
      taskTitle: task.title,
    })
    .from(projectLearnedRule)
    .leftJoin(task, eq(task.id, projectLearnedRule.sourceTaskId))
    .where(
      and(
        eq(projectLearnedRule.projectId, projectId),
        skillName ? eq(projectLearnedRule.skillName, skillName) : undefined,
      ),
    )
    .orderBy(desc(projectLearnedRule.createdAt));

  return rows.map((r) => ({
    ...r,
    sourceTaskKey: r.taskNumber ? `T-${r.taskNumber}` : undefined,
  }));
}

export async function deleteLearnedRule(userId: string, ruleId: string) {
  if (!isUuid(ruleId)) throw new NotFoundError("Rule not found");
  const [row] = await db
    .select()
    .from(projectLearnedRule)
    .where(eq(projectLearnedRule.id, ruleId));
  if (!row) throw new NotFoundError("Rule not found");
  await requireProject(userId, row.projectId);
  await db.delete(projectLearnedRule).where(eq(projectLearnedRule.id, ruleId));
  return row;
}

export type MatchedSkill = {
  name: string;
  kind: "guide" | "review";
  scope: "project" | "org";
  source: string;
  reason: string;
};

export type MatchedLearnedRule = {
  id: string;
  rule: string;
  skillName: string;
  source: string;
  sourceTaskKey?: string;
  createdAt: Date;
};

/**
 * Context-aware automatic skill & gotcha injection for task execution.
 * Evaluates task role, title, description, and contracts to assemble
 * the precise set of standards, learned gotchas, and architecture references.
 */
export async function matchSkillsForTask(userId: string, taskId: string) {
  const [t] = await db.select().from(task).where(eq(task.id, taskId));
  if (!t) throw new NotFoundError("Task not found");
  const { orgId } = await requireProject(userId, t.projectId);

  const [availableSkills, learnedRules, projectDocs] = await Promise.all([
    availableAgents(userId, { projectId: t.projectId }),
    listLearnedRules(userId, t.projectId),
    db
      .select({
        id: document.id,
        title: document.title,
        docType: document.docType,
        version: document.currentVersion,
      })
      .from(document)
      .where(eq(document.projectId, t.projectId)),
  ]);

  const taskText =
    `${t.title} ${t.description} ${t.outputContract ?? ""}`.toLowerCase();
  const taskKeywords = new Set(extractKeywords(taskText));

  const matchedSkills: MatchedSkill[] = [];
  const matchedSkillNames = new Set<string>();

  // 0. The agent a person assigned always comes first.
  const assigned = t.assignedSkill
    ? availableSkills.find((item) => item.name === t.assignedSkill)
    : undefined;
  if (assigned) {
    matchedSkillNames.add(assigned.name);
    matchedSkills.push({
      name: assigned.name,
      kind: assigned.kind,
      scope: assigned.projectId ? "project" : "org",
      source: assigned.source,
      reason: "Assigned agent",
    });
  }

  // 1. Role-based matching — org-configurable (spec 025); falls back to the old hardcoded
  // defaults when the org hasn't set up its own routing on the /flow canvas.
  const primaryRoleSkills = await effectiveRoleSkills(orgId, t.role);
  for (const name of primaryRoleSkills) {
    const s = availableSkills.find((item) => item.name === name);
    if (s && !matchedSkillNames.has(s.name)) {
      matchedSkillNames.add(s.name);
      matchedSkills.push({
        name: s.name,
        kind: s.kind,
        scope: s.projectId ? "project" : "org",
        source: s.source,
        reason: `Matched task role: ${t.role}`,
      });
    }
  }

  // 2. Content & Domain heuristic matching
  const hasDbKeywords =
    taskKeywords.has("database") ||
    taskKeywords.has("db") ||
    taskKeywords.has("migration") ||
    taskKeywords.has("migrations") ||
    taskKeywords.has("sql") ||
    taskKeywords.has("drizzle") ||
    taskKeywords.has("schema") ||
    taskKeywords.has("table") ||
    taskKeywords.has("postgres");

  const hasApiKeywords =
    taskKeywords.has("api") ||
    taskKeywords.has("endpoint") ||
    taskKeywords.has("rest") ||
    taskKeywords.has("route") ||
    taskKeywords.has("server");

  for (const s of availableSkills) {
    if (matchedSkillNames.has(s.name)) continue;

    const skillText = `${s.name} ${s.description}`.toLowerCase();
    let matchReason: string | null = null;

    if (
      hasDbKeywords &&
      (skillText.includes("db") ||
        skillText.includes("database") ||
        skillText.includes("migration") ||
        skillText.includes("schema"))
    ) {
      matchReason = "Matched domain: Database & Migrations";
    } else if (
      hasApiKeywords &&
      (skillText.includes("api") ||
        skillText.includes("endpoint") ||
        skillText.includes("route"))
    ) {
      matchReason = "Matched domain: API & Endpoints";
    } else {
      const skillKeywords = extractKeywords(skillText);
      const overlap = skillKeywords.some((k) => taskKeywords.has(k));
      if (overlap) {
        matchReason = "Matched task context keywords";
      }
    }

    if (matchReason) {
      matchedSkillNames.add(s.name);
      matchedSkills.push({
        name: s.name,
        kind: s.kind,
        scope: s.projectId ? "project" : "org",
        source: s.source,
        reason: matchReason,
      });
    }
  }

  // If still empty, supply default code-review or available review skill
  if (matchedSkills.length === 0) {
    const fallback =
      availableSkills.find((s) => s.kind === "review") ?? availableSkills[0];
    if (fallback) {
      matchedSkills.push({
        name: fallback.name,
        kind: fallback.kind,
        scope: fallback.projectId ? "project" : "org",
        source: fallback.source,
        reason: "Standard project quality guideline",
      });
    }
  }

  // 3. Relevant Architecture Documents
  const suggestedDocs = projectDocs.filter((d) => {
    if (hasDbKeywords && d.docType === "erd") return true;
    if (hasApiKeywords && d.docType === "lld") return true;
    if (d.docType === "prd") return true;
    return false;
  });

  // 4. Relevant Learned Rules
  const relevantRules: MatchedLearnedRule[] = learnedRules.map((r) => ({
    id: r.id,
    rule: r.rule,
    skillName: r.skillName,
    source: r.source,
    sourceTaskKey: r.sourceTaskKey,
    createdAt: r.createdAt,
  }));

  return {
    matchedSkills,
    learnedRules: relevantRules,
    suggestedDocs,
  };
}

/** Every learned rule in the workspace, newest first, with the project and task it came from. */
export async function listOrgLearnedRules(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  const rows = await db
    .select({
      id: projectLearnedRule.id,
      projectId: projectLearnedRule.projectId,
      projectName: project.name,
      skillName: projectLearnedRule.skillName,
      rule: projectLearnedRule.rule,
      source: projectLearnedRule.source,
      createdAt: projectLearnedRule.createdAt,
      sourceTaskId: projectLearnedRule.sourceTaskId,
      taskNumber: task.number,
    })
    .from(projectLearnedRule)
    .innerJoin(project, eq(project.id, projectLearnedRule.projectId))
    .leftJoin(task, eq(task.id, projectLearnedRule.sourceTaskId))
    .where(eq(projectLearnedRule.orgId, orgId))
    .orderBy(desc(projectLearnedRule.createdAt));
  return rows.map((r) => ({
    ...r,
    sourceTaskKey: r.taskNumber ? `T-${r.taskNumber}` : undefined,
  }));
}

/** Names of every agent (skill) usable in a project: workspace, project overrides and built-in defaults. */
export async function listAgentNames(userId: string, projectId: string) {
  return new Set(
    (await availableAgents(userId, { projectId })).map((a) => a.name),
  );
}
