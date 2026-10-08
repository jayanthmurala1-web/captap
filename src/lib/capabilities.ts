/** What a role can do (spec 016). Each maps 1:1 to a check that used to be a hardcoded owner/admin/lead test. */
export const CAPABILITY_INFO = {
  invite_members: {
    scope: "org",
    label: "Invite people",
    description:
      "Create and cancel invitations, and choose the role they join with.",
  },
  manage_roles: {
    scope: "org",
    label: "Manage roles",
    description: "Create and edit roles, and change what role each person has.",
  },
  create_projects: {
    scope: "org",
    label: "Create projects",
    description: "Start new client projects.",
  },
  manage_org_settings: {
    scope: "org",
    label: "Workspace settings",
    description: "Workspace-wide agent rules and webhooks.",
  },
  access_all_projects: {
    scope: "org",
    label: "See every project",
    description: "Open any project in the workspace, not only assigned ones.",
  },
  use_ai: {
    scope: "org",
    label: "Use Consult",
    description:
      "Chat with agents. Uses the workspace's AI budget or provider keys.",
  },
  manage_ai_keys: {
    scope: "org",
    label: "AI providers and keys",
    description:
      "Connect provider API keys and choose the workspace's default model.",
  },
  view_audit_log: {
    scope: "org",
    label: "Activity log",
    description: "Read the record of who did what.",
  },
  approve_tasks: {
    scope: "project",
    label: "Approve work",
    description:
      "Approve a submitted task. Nobody can approve their own submission.",
  },
  manage_tasks: {
    scope: "project",
    label: "Manage tasks",
    description: "Create, edit, assign and delete tasks and epics.",
  },
  manage_documents: {
    scope: "project",
    label: "Manage documents",
    description: "Create, edit and delete any project document.",
  },
  share_with_client: {
    scope: "project",
    label: "Client approval links",
    description: "Create and revoke client share links.",
  },
  manage_project_settings: {
    scope: "project",
    label: "Project settings",
    description: "GitHub repository, project members and webhooks.",
  },
} as const;

export type Capability = keyof typeof CAPABILITY_INFO;

export const CAPABILITIES = Object.keys(CAPABILITY_INFO) as Capability[];

export const isCapability = (v: string): v is Capability =>
  v in CAPABILITY_INFO;

const PROJECT_CAPS = CAPABILITIES.filter(
  (c) => CAPABILITY_INFO[c].scope === "project",
);

/** Seeded per org. Keep in step with the INSERT in drizzle/0019 (which snapshots these for existing orgs). */
export const SYSTEM_ROLES: {
  slug: string;
  name: string;
  capabilities: Capability[];
}[] = [
  { slug: "owner", name: "Owner", capabilities: CAPABILITIES },
  { slug: "admin", name: "Admin", capabilities: CAPABILITIES },
  { slug: "member", name: "Member", capabilities: ["use_ai"] },
  { slug: "lead", name: "Lead", capabilities: [...PROJECT_CAPS, "use_ai"] },
  { slug: "qa", name: "QA", capabilities: ["approve_tasks", "use_ai"] },
  {
    slug: "product",
    name: "Product",
    capabilities: ["approve_tasks", "use_ai"],
  },
  { slug: "developer", name: "Developer", capabilities: ["use_ai"] },
  { slug: "devops", name: "DevOps", capabilities: ["use_ai"] },
];
