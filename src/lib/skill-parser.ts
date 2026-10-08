import { parse, stringify } from "yaml";
import { z } from "zod";
import { ValidationError } from "./errors";

export class SkillParseError extends ValidationError {}

export const MAX_SKILL_BYTES = 100_000;

// agentskills.io/specification: 1-64 chars, a-z 0-9 hyphen, no leading/trailing/consecutive hyphens.
export const skillName = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "name: lowercase letters, digits and single hyphens only",
  )
  .max(64, "name: max 64 characters");

const frontmatter = z.object({
  name: skillName,
  description: z
    .string()
    .trim()
    .min(1, "description is required")
    .max(1024, "description: max 1024 characters"),
});

/** Validates a SKILL.md and returns its normalized source plus indexed fields. */
export function parseSkill(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_SKILL_BYTES) {
    throw new SkillParseError("SKILL.md is larger than 100 KB");
  }
  const source = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match)
    throw new SkillParseError(
      "SKILL.md must start with YAML frontmatter between --- lines",
    );

  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (e) {
    throw new SkillParseError(
      `Invalid YAML frontmatter: ${(e as Error).message}`,
    );
  }
  const result = frontmatter.safeParse(data);
  if (!result.success)
    throw new SkillParseError(
      result.error.issues.map((i) => i.message).join("; "),
    );
  return { source, ...result.data };
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** A playbook as the agent form edits it: name, description, and the markdown body. */
export function splitSkill(raw: string) {
  const { source, name, description } = parseSkill(raw);
  const body = source.replace(FRONTMATTER, "").replace(/^\n+/, "");
  return { name, description, body };
}

/** Build a SKILL.md from form fields, keeping any other front-matter keys of the previous version. */
export function composeSkill(
  fields: { name: string; description: string; body: string },
  previousSource?: string,
) {
  let extra: Record<string, unknown> = {};
  const prev = previousSource
    ? FRONTMATTER.exec(previousSource.replace(/\r\n/g, "\n"))
    : null;
  if (prev) {
    const data = parse(prev[1]);
    if (data && typeof data === "object")
      extra = data as Record<string, unknown>;
  }
  const front = stringify({
    ...extra,
    name: fields.name.trim(),
    description: fields.description.trim(),
  }).trimEnd();
  return `---\n${front}\n---\n\n${fields.body.trim()}\n`;
}
