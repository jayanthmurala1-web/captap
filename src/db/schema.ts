import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

export * from "./auth-schema";

export const projectAutonomyLevel = pgEnum("project_autonomy_level", [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
]);
export type ProjectAutonomyLevel =
  (typeof projectAutonomyLevel.enumValues)[number];

export type AutoApprovalPolicy = {
  requireZeroBlockingReviews?: boolean;
  requirePassingCi?: boolean;
  maxAutoApprovedPerDay?: number;
  autoMergePr?: boolean;
};

// Every tenant-owned table carries orgId. Access goes through src/lib/*, never raw db in routes.
export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    githubRepo: text("github_repo"),
    taskSeq: integer("task_seq").notNull().default(0), // reserved atomically for T-numbers
    autonomyLevel: projectAutonomyLevel("autonomy_level")
      .notNull()
      .default("L2"),
    autoApprovalPolicy: jsonb(
      "auto_approval_policy",
    ).$type<AutoApprovalPolicy>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("project_org_id_idx").on(t.orgId)],
);

/** Org-defined role (spec 016). `slug` is what member.role / project_member.role / invitation.role store. */
export const orgRole = pgTable(
  "org_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    capabilities: text("capabilities").array().notNull().default([]),
    /** Seeded roles; `owner` is additionally locked in code. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("org_role_org_slug_uq").on(t.orgId, t.slug)],
);

export const projectMember = pgTable(
  "project_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("developer"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("project_member_project_user_uq").on(t.projectId, t.userId),
    index("project_member_project_id_idx").on(t.projectId),
    index("project_member_user_id_idx").on(t.userId),
  ],
);

export const skillKind = pgEnum("skill_kind", ["guide", "review"]);

// One Agent Skills SKILL.md per row, stored verbatim. projectId null = org-level skill.
export const skill = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: skillKind("kind").notNull().default("guide"),
    source: text("source").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique("skill_scope_name_uq")
      .on(t.orgId, t.projectId, t.name)
      .nullsNotDistinct(),
  ],
);

// A published copy of an org-level skill (spec 022). Independent of the live `skill` row: editing the
// org's own skill later does not change what's published; publishing again overwrites this row.
export const marketplaceSkill = pgTable(
  "marketplace_skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null = published by Captap itself (seed content), not a customer org.
    orgId: text("org_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    publisherLabel: text("publisher_label").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    pitch: text("pitch").notNull(),
    githubRepo: text("github_repo"),
    kind: skillKind("kind").notNull().default("guide"),
    source: text("source").notNull(),
    // Nullable + set null on delete: this is an audit trail of who last published/seeded a listing,
    // not an ownership link — a listing (especially cross-org seed content) must outlive its publisher's account.
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique("marketplace_skill_org_name_uq")
      .on(t.orgId, t.name)
      .nullsNotDistinct(),
  ],
);

export const docTypeValues = [
  "brief",
  "pr_faq",
  "strategy_memo",
  "brd",
  "prd",
  "hld",
  "lld",
  "erd",
  "work_ledger",
  "general",
] as const;
export type DocType = (typeof docTypeValues)[number] | (string & {});

export const visibilityValues = ["draft", "published"] as const;
export type DocVisibility = (typeof visibilityValues)[number];

export const documentKind = pgEnum("document_kind", ["prd", "doc"]);

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull().default("doc"),
    docType: text("doc_type").notNull().default("general"),
    visibility: text("visibility").notNull().default("published"),
    title: text("title").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("document_project_id_idx").on(t.projectId)],
);

// Immutable snapshots: never updated, only appended.
export const documentVersion = pgTable(
  "document_version",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    note: text("note"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.version] })],
);

// A revocable, unguessable link letting a client (no account) view one document (spec 013).
export const documentShare = pgTable(
  "document_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("document_share_document_id_idx").on(t.documentId)],
);

export const approvalDecision = pgEnum("approval_decision", [
  "approved",
  "changes_requested",
]);

// A client's decision on one specific document version (spec 013). Never edited, only appended.
export const documentApproval = pgTable(
  "document_approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    decision: approvalDecision("decision").notNull(),
    approverName: text("approver_name").notNull(),
    approverEmail: text("approver_email"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("document_approval_document_id_idx").on(t.documentId)],
);

/**
 * One row per Acceptance Criteria bullet of a PRD (spec 017). The key ("R-4") is written into the
 * document text; `removedAt` is set when the bullet disappears from the latest version, and keys are never reused.
 */
export const requirement = pgTable(
  "requirement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    text: text("text").notNull(),
    removedAt: timestamp("removed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("requirement_document_key_uq").on(t.documentId, t.key),
    index("requirement_project_id_idx").on(t.projectId),
  ],
);

export const taskRole = pgEnum("task_role", [
  "developer",
  "devops",
  "qa",
  "product",
]);
export type TaskRole = (typeof taskRole.enumValues)[number];

// Which skill(s) a task role auto-matches to (spec 025). An org with zero rows here keeps the old
// hardcoded default in matchSkillsForTask — this only overrides once an org actually configures it.
export const roleSkillRoute = pgTable(
  "role_skill_route",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: taskRole("role").notNull(),
    skillName: text("skill_name").notNull(),
  },
  (t) => [
    unique("role_skill_route_org_role_skill_uq").on(
      t.orgId,
      t.role,
      t.skillName,
    ),
  ],
);

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "in_review",
  "done",
]);
export const submissionDecision = pgEnum("submission_decision", [
  "pending",
  "approved",
  "rejected",
]);

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** The PRD this task is built under (spec 017); requirement links are in task_requirement. */
    prdDocumentId: uuid("prd_document_id").references(() => document.id, {
      onDelete: "set null",
    }),
    /** "Epic › Story" carried over from before spec 017; shown as a muted label only. */
    legacyGroup: text("legacy_group"),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    role: taskRole("role").notNull(),
    status: taskStatus("status").notNull().default("todo"),
    storyPoints: integer("story_points").default(1),
    // The agent (skill name) a person assigned; its playbook is given to whoever works the task first.
    assignedSkill: text("assigned_skill"),
    outputContract: text("output_contract"), // JSON-serialized contract for specialist agents
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    claimedBy: text("claimed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    claimedAgent: text("claimed_agent"),
    claimedAt: timestamp("claimed_at"),
    reviewNote: text("review_note"), // latest rejection reason, shown to the claiming agent
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique("task_project_number_uq").on(t.projectId, t.number),
    index("task_project_status_idx").on(t.projectId, t.status),
    index("task_prd_document_id_idx").on(t.prdDocumentId),
  ],
);

export const taskRequirement = pgTable(
  "task_requirement",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirement.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.requirementId] }),
    index("task_requirement_requirement_id_idx").on(t.requirementId),
  ],
);

export const taskDependency = pgTable(
  "task_dependency",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    index("task_dependency_depends_on_idx").on(t.dependsOnId),
  ],
);

export type TestRun = { command: string; exitCode: number; summary: string };
export type ReviewFinding = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  fileLine?: string;
  problem: string;
  impact?: string;
  fix?: string;
};
export type CriterionCheck = {
  criterion: string;
  passed: boolean;
  evidence?: string;
};
export type ReviewResult = {
  skill: string;
  status: "PASS" | "NEEDS_WORK" | "FAIL";
  summary: string;
  blocking?: boolean;
  findings?: ReviewFinding[];
  criteriaChecks?: CriterionCheck[];
  reviewedAt?: string;
  automated?: boolean;
};
export type VerificationDetails = {
  commitExists: boolean;
  commitUrl?: string;
  commitAuthor?: string;
  commitMessage?: string;
  branchExists?: boolean;
  ciStatus: "success" | "failure" | "pending" | "none";
  ciDetails?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    url?: string;
  }>;
  prNumber?: number;
  prUrl?: string;
  prState?: "open" | "closed" | "merged";
  verifiedAt: string;
  error?: string;
};

// Agent-reported evidence; one row per submit attempt, decided by a human.
export const taskSubmission = pgTable(
  "task_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => user.id),
    agent: text("agent").notNull(),
    summary: text("summary").notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    filesChanged: jsonb("files_changed").$type<string[]>().notNull(),
    tests: jsonb("tests").$type<TestRun[]>().notNull(),
    reviews: jsonb("reviews").$type<ReviewResult[]>().notNull().default([]),
    verificationStatus: text("verification_status")
      .notNull()
      .default("unverified"),
    verificationDetails: jsonb(
      "verification_details",
    ).$type<VerificationDetails>(),
    decision: submissionDecision("decision").notNull().default("pending"),
    decisionNote: text("decision_note"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("task_submission_task_idx").on(t.taskId)],
);

export const learnedRuleSource = pgEnum("learned_rule_source", [
  "human_critique",
  "persona_review",
  "manual",
]);

export const projectLearnedRule = pgTable(
  "project_learned_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    skillName: text("skill_name").notNull().default("code-review"),
    rule: text("rule").notNull(),
    source: learnedRuleSource("source").notNull().default("human_critique"),
    sourceTaskId: uuid("source_task_id").references(() => task.id, {
      onDelete: "set null",
    }),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("project_learned_rule_project_skill_idx").on(
      t.projectId,
      t.skillName,
    ),
    index("project_learned_rule_project_created_idx").on(
      t.projectId,
      t.createdAt,
    ),
    index("project_learned_rule_task_idx").on(t.sourceTaskId),
  ],
);

export type ProjectLearnedRule = typeof projectLearnedRule.$inferSelect;
export type NewProjectLearnedRule = typeof projectLearnedRule.$inferInsert;

export const swarmStage = pgEnum("swarm_stage", [
  "build",
  "test",
  "review",
  "approval",
]);

export type HandoffArtifacts = {
  commitSha?: string;
  branch?: string;
  worktree?: string;
  testResults?: TestRun[];
  reviewFindings?: ReviewFinding[];
  filesChanged?: string[];
  notes?: string;
};

export const taskHandoff = pgTable(
  "task_handoff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    stage: swarmStage("stage").notNull(),
    fromAgent: text("from_agent").notNull(),
    fromRole: taskRole("from_role").notNull(),
    toRole: taskRole("to_role").notNull(),
    toAgent: text("to_agent"),
    note: text("note").notNull().default(""),
    artifacts: jsonb("artifacts")
      .$type<HandoffArtifacts>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("task_handoff_task_idx").on(t.taskId),
    index("task_handoff_created_at_idx").on(t.createdAt),
  ],
);

export type TaskHandoff = typeof taskHandoff.$inferSelect;
export type NewTaskHandoff = typeof taskHandoff.$inferInsert;

export const worktreeStatus = pgEnum("worktree_status", [
  "active",
  "submitted",
  "merged",
  "pruned",
]);

export const taskWorktree = pgTable(
  "task_worktree",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    worktreePath: text("worktree_path").notNull(),
    baseRef: text("base_ref").notNull().default("main"),
    status: worktreeStatus("status").notNull().default("active"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    prState: text("pr_state"),
    allocatedBy: text("allocated_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("task_worktree_task_idx").on(t.taskId),
    index("task_worktree_project_idx").on(t.projectId),
    index("task_worktree_status_idx").on(t.status),
  ],
);

export type TaskWorktree = typeof taskWorktree.$inferSelect;
export type NewTaskWorktree = typeof taskWorktree.$inferInsert;

export const webhookEventType = pgEnum("webhook_event_type", [
  "task.created",
  "task.claimed",
  "task.submitted",
  "task.approved",
  "task.rejected",
  "task.handoff",
  "worktree.provisioned",
  "pr.synthesized",
  "doc.published",
  "ping",
]);
export type WebhookEventType = (typeof webhookEventType.enumValues)[number];

export const webhookSubscription = pgTable(
  "webhook_subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<WebhookEventType[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("webhook_subscription_org_idx").on(t.orgId),
    index("webhook_subscription_project_idx").on(t.projectId),
  ],
);

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscription.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  },
  (t) => [
    index("webhook_delivery_subscription_idx").on(t.subscriptionId),
    index("webhook_delivery_delivered_at_idx").on(t.deliveredAt),
  ],
);

export type WebhookSubscription = typeof webhookSubscription.$inferSelect;
export type NewWebhookSubscription = typeof webhookSubscription.$inferInsert;
export type WebhookDelivery = typeof webhookDelivery.$inferSelect;
export type NewWebhookDelivery = typeof webhookDelivery.$inferInsert;

export const agentExecutionTelemetry = pgTable(
  "agent_execution_telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    taskId: uuid("task_id").references(() => task.id, {
      onDelete: "set null",
    }),
    agentName: text("agent_name").notNull().default("consult"),
    modelProvider: text("model_provider").notNull().default("groq"),
    modelName: text("model_name").notNull().default("openai/gpt-oss-120b"),
    /** Who paid for the call (spec 021): our key ("platform", metered against the plan) or the org's own ("org"). */
    keySource: text("key_source").notNull().default("platform"),
    userId: text("user_id"),
    /** consult | review | drift */
    purpose: text("purpose").notNull().default("consult"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    estimatedCostUsd: text("estimated_cost_usd").notNull().default("0.000000"),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status").notNull().default("success"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("agent_telemetry_org_idx").on(t.orgId),
    index("agent_telemetry_project_idx").on(t.projectId),
    index("agent_telemetry_task_idx").on(t.taskId),
    index("agent_telemetry_created_at_idx").on(t.createdAt),
  ],
);

export type AgentExecutionTelemetry =
  typeof agentExecutionTelemetry.$inferSelect;
export type NewAgentExecutionTelemetry =
  typeof agentExecutionTelemetry.$inferInsert;

export const previewDeploymentStatus = pgEnum("preview_deployment_status", [
  "pending",
  "building",
  "ready",
  "failed",
]);
export type PreviewDeploymentStatus =
  (typeof previewDeploymentStatus.enumValues)[number];

export const previewDeployment = pgTable(
  "preview_deployment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    worktreeId: uuid("worktree_id").references(() => taskWorktree.id, {
      onDelete: "set null",
    }),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    url: text("url").notNull(),
    status: previewDeploymentStatus("status").notNull().default("building"),
    logs: text("logs").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("preview_deployment_org_idx").on(t.orgId),
    index("preview_deployment_project_idx").on(t.projectId),
    index("preview_deployment_task_idx").on(t.taskId),
  ],
);

export type PreviewDeployment = typeof previewDeployment.$inferSelect;
export type NewPreviewDeployment = typeof previewDeployment.$inferInsert;

/**
 * Append-only record of who did what (spec 018). A database trigger rejects UPDATE and DELETE
 * (except when the whole organization is deleted), so not even app code can rewrite history.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    /** Null for the no-account client; `actorLabel` still names them. */
    actorId: text("actor_id"),
    /** Name at the time: people rename and leave. */
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("audit_event_org_created_idx").on(t.orgId, t.createdAt)],
);

/**
 * Shared request counters (spec 019). Serverless instances don't share memory, so limits live here.
 * Better Auth's limiter uses this model as-is (`key`, `count`, `lastRequest`); ours keys start with
 * "api:" and treat `lastRequest` as the start of the current fixed window.
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** An org's own LLM provider key, encrypted at rest (spec 021, src/lib/secrets.ts). One per provider. */
export const aiProviderKey = pgTable(
  "ai_provider_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** groq | openai | anthropic | google | xai | cohere */
    provider: text("provider").notNull(),
    /** "v1.<iv>.<tag>.<data>"; AAD is "orgId:provider". Never returned to the browser. */
    ciphertext: text("ciphertext").notNull(),
    /** Last 4 characters, the only part of the key the UI ever shows. */
    keyHint: text("key_hint").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    lastUsedAt: timestamp("last_used_at"),
    /** Sanitized provider error from the last failed call; contains no key material. */
    lastError: text("last_error"),
  },
  (t) => [unique("ai_provider_key_org_provider_uq").on(t.orgId, t.provider)],
);

export const connectionKind = pgEnum("connection_kind", [
  "slack_webhook",
  "github_pat",
  "custom_mcp",
]);

/** An org's connection to an external tool (spec 023). Secret is encrypted the same way as
 * ai_provider_key (src/lib/secrets.ts), AAD "orgId:connectionId" so a copied row can't decrypt. */
export const connection = pgTable(
  "connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: connectionKind("kind").notNull(),
    label: text("label").notNull(),
    /** custom_mcp only: the server URL (not secret). Null for the other kinds. */
    url: text("url"),
    /** "v1.<iv>.<tag>.<data>" — the webhook URL itself (slack_webhook), the PAT (github_pat), or
     * the bearer token (custom_mcp, optional). Never returned to the browser. */
    ciphertext: text("ciphertext"),
    /** Last 4 characters of whatever is encrypted, the only part the UI ever shows. */
    secretHint: text("secret_hint"),
    // Nullable + set null on delete, same reasoning as marketplace_skill.publishedBy (spec 022):
    // an audit trail of who last connected it, not an ownership link — the org's Slack notifications
    // shouldn't stop working just because the person who connected them later left.
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [unique("connection_org_kind_label_uq").on(t.orgId, t.kind, t.label)],
);

export const orgAiSettings = pgTable("org_ai_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** free | paid. Only read on the cloud deployment; set by hand until payments exist. */
  plan: text("plan").notNull().default("free"),
  /** Used by reviews, the drift check and as the chat's preselection. */
  defaultProvider: text("default_provider"),
  defaultModel: text("default_model"),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
