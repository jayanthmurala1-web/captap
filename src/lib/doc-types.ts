const LABELS: Record<string, string> = {
  prd: "PRD",
  brief: "Client brief",
  pr_faq: "PR/FAQ",
  strategy_memo: "Strategy memo",
  brd: "BRD",
  hld: "High-level design",
  lld: "Low-level design",
  erd: "Data model",
  work_ledger: "Work ledger",
  general: "Document",
};

/** Human label for a docType, including user-made `custom_<slug>` types. */
export function docTypeLabel(docType: string) {
  if (LABELS[docType]) return LABELS[docType];
  const slug = docType
    .replace(/^custom_/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return slug ? slug[0].toUpperCase() + slug.slice(1) : "Document";
}

/** Starting content for a new document; a PRD must pass the linter (spec 011) to be saved. */
export function docTemplate(docType: string) {
  if (docType === "prd") {
    return `## Problem & Context
Who has this problem, what it costs them today, and why it matters now. (The linter needs at least 50 words here.)

## Goals
-

## Non-Goals
-
-

## Acceptance Criteria
- Given …, when …, then …
`;
  }
  return "";
}
