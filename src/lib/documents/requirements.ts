import { ACCEPTANCE_HEADINGS } from "./validator";

/**
 * A requirement is one top-level bullet of a PRD's Acceptance Criteria (spec 017). Its stable key
 * lives in the text ("- R-4: Customer can pay by card"), so agents, the drift check and the client
 * all read the same id. Keys are never reused, even after a bullet is deleted.
 */
export type NumberedRequirement = { key: string; text: string };

const HEADING = /^#{1,6}\s+(.+?)\s*$/;
// group 1: bullet + optional checkbox; group 2: existing "R-n: " marker; group 3: its number; group 4: text
const BULLET =
  /^( {0,1}(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(R-(\d+):\s*)?(.*\S.*)$/;

/**
 * Writes a key onto every unmarked acceptance bullet and returns the bullets in document order.
 * `taken` is the highest key number ever used for this PRD (removed ones included).
 */
export function numberRequirements(content: string, taken: number) {
  const lines = content.split("\n");
  const inSection: number[] = [];
  let active = false;
  lines.forEach((line, i) => {
    const h = line.match(HEADING);
    if (h) active = ACCEPTANCE_HEADINGS.includes(h[1].toLowerCase());
    else if (active) inSection.push(i);
  });

  let next = taken;
  for (const i of inSection) {
    const m = lines[i].match(BULLET);
    if (m?.[3]) next = Math.max(next, Number(m[3]));
  }

  const items: NumberedRequirement[] = [];
  const seen = new Set<string>();
  for (const i of inSection) {
    const m = lines[i].match(BULLET);
    if (!m) continue;
    let key = m[2] ? `R-${m[3]}` : null;
    if (!key || seen.has(key)) {
      key = `R-${++next}`;
      lines[i] = `${m[1]}${key}: ${m[4]}`;
    }
    seen.add(key);
    items.push({ key, text: m[4].trim() });
  }
  return { content: lines.join("\n"), items };
}
