import { ValidationError } from "../errors";

const PROBLEM_HEADINGS = [
  "problem",
  "problem & context",
  "problem and context",
];
const NON_GOALS_HEADINGS = ["non-goals", "explicit non-goals"];
export const ACCEPTANCE_HEADINGS = [
  "acceptance criteria",
  "verifiable acceptance criteria",
];
const MIN_PROBLEM_WORDS = 50;
const MIN_NON_GOALS_ITEMS = 2;

function sections(content: string) {
  const lines = content.split("\n");
  const result: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) {
      if (current)
        result.push({
          heading: current.heading,
          body: current.body.join("\n"),
        });
      current = { heading: match[1].toLowerCase(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current)
    result.push({ heading: current.heading, body: current.body.join("\n") });
  return result;
}

function findSection(
  secs: { heading: string; body: string }[],
  names: string[],
) {
  return secs.find((s) => names.includes(s.heading));
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function bulletCount(text: string) {
  return text.split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
}

/** Zero-token, deterministic structural check for PRD documents (spec 011). Throws ValidationError listing every violation. */
export function validatePrdStructure(content: string) {
  const secs = sections(content);
  const errors: string[] = [];

  const problem = findSection(secs, PROBLEM_HEADINGS);
  if (!problem) {
    errors.push("Missing a Problem & Context section");
  } else if (wordCount(problem.body) < MIN_PROBLEM_WORDS) {
    errors.push(
      `Problem & Context section is too short (must be at least ${MIN_PROBLEM_WORDS} words)`,
    );
  }

  const nonGoals = findSection(secs, NON_GOALS_HEADINGS);
  if (!nonGoals) {
    errors.push("Missing a Non-Goals section");
  } else if (bulletCount(nonGoals.body) < MIN_NON_GOALS_ITEMS) {
    errors.push(
      `Non-Goals section must list at least ${MIN_NON_GOALS_ITEMS} items`,
    );
  }

  const acceptance = findSection(secs, ACCEPTANCE_HEADINGS);
  if (!acceptance) {
    errors.push("Missing an Acceptance Criteria section");
  } else if (acceptance.body.trim().length === 0) {
    errors.push("Acceptance Criteria section is empty");
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "));
  }
}
