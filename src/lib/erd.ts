/**
 * The ERD lives in the document as a mermaid `erDiagram` block (agents write it, the
 * drift check reads it). The canvas edits this model and writes the block back; the
 * saved table positions ride along as a mermaid comment, so they're versioned with
 * the document and every viewer sees the same layout.
 */
export type ErdColumn = {
  type: string;
  name: string;
  keys: string[];
  comment?: string;
};
export type ErdTable = { name: string; columns: ErdColumn[] };
export type ErdRelation = {
  from: string;
  to: string;
  /** Cardinality on the `from` side, e.g. "||", "|o", "}o", "}|". */
  left: string;
  /** Cardinality on the `to` side, e.g. "||", "o|", "o{", "|{". */
  right: string;
  /** `--` (identifying) vs `..` (non-identifying). */
  identifying: boolean;
  label: string;
};
export type Erd = {
  tables: ErdTable[];
  relations: ErdRelation[];
  layout: Record<string, { x: number; y: number }>;
};

const BLOCK = /```mermaid\s*\n\s*erDiagram[\s\S]*?```/;
const LAYOUT = "%% captap-layout ";
const NAME = "[A-Za-z0-9_-]+";
const REL = new RegExp(
  `^(${NAME})\\s+([|}][|o]|[o|][|])(--|\\.\\.)([|o][|{]|[|o][|])\\s+(${NAME})\\s*:\\s*(?:"([^"]*)"|(.*))$`,
);

export function parseErd(markdown: string): Erd {
  const erd: Erd = { tables: [], relations: [], layout: {} };
  const block = BLOCK.exec(markdown)?.[0];
  if (!block) return erd;
  const table = (name: string) => {
    let t = erd.tables.find((x) => x.name === name);
    if (!t) {
      t = { name, columns: [] };
      erd.tables.push(t);
    }
    return t;
  };

  let current: ErdTable | null = null;
  for (const raw of block.split("\n").slice(1, -1)) {
    const line = raw.trim();
    if (!line || line === "erDiagram") continue;
    if (line.startsWith(LAYOUT)) {
      try {
        erd.layout = JSON.parse(line.slice(LAYOUT.length));
      } catch {
        // A hand-edited, broken layout just falls back to auto-layout.
      }
      continue;
    }
    if (line.startsWith("%%")) continue;
    if (current) {
      if (line === "}") {
        current = null;
        continue;
      }
      const m =
        /^(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/.exec(
          line,
        );
      if (m) {
        const col: ErdColumn = {
          type: m[1],
          name: m[2],
          keys: m[3] ? m[3].split(",").map((k) => k.trim()) : [],
        };
        if (m[4] !== undefined) col.comment = m[4];
        current.columns.push(col);
      }
      continue;
    }
    const open = new RegExp(`^(${NAME})\\s*\\{$`).exec(line);
    if (open) {
      current = table(open[1]);
      continue;
    }
    const rel = REL.exec(line);
    if (rel) {
      table(rel[1]);
      table(rel[5]);
      erd.relations.push({
        from: rel[1],
        to: rel[5],
        left: rel[2],
        right: rel[4],
        identifying: rel[3] === "--",
        label: (rel[6] ?? rel[7] ?? "").trim(),
      });
    }
  }
  return erd;
}

export function serializeErd(erd: Erd): string {
  const lines = ["```mermaid", "erDiagram"];
  for (const r of erd.relations) {
    const label = /^[A-Za-z0-9_-]+$/.test(r.label) ? r.label : `"${r.label}"`;
    lines.push(
      `  ${r.from} ${r.left}${r.identifying ? "--" : ".."}${r.right} ${r.to} : ${label}`,
    );
  }
  for (const t of erd.tables) {
    lines.push("", `  ${t.name} {`);
    for (const c of t.columns) {
      const keys = c.keys.length ? ` ${c.keys.join(",")}` : "";
      const comment =
        c.comment !== undefined ? ` "${c.comment.replaceAll('"', "'")}"` : "";
      lines.push(`    ${c.type} ${c.name}${keys}${comment}`);
    }
    lines.push("  }");
  }
  // Only positions of tables that still exist.
  const layout = Object.fromEntries(
    Object.entries(erd.layout)
      .filter(([name]) => erd.tables.some((t) => t.name === name))
      .map(([name, p]) => [name, { x: Math.round(p.x), y: Math.round(p.y) }]),
  );
  if (Object.keys(layout).length)
    lines.push("", `  ${LAYOUT}${JSON.stringify(layout)}`);
  lines.push("```");
  return lines.join("\n");
}

/** Put the diagram back into the document, keeping everything around it. */
export function replaceErdBlock(markdown: string, block: string) {
  return BLOCK.test(markdown)
    ? markdown.replace(BLOCK, () => block)
    : `${markdown.trimEnd()}\n\n${block}\n`;
}

/** The document without its diagram block (the canvas shows the diagram instead). */
export function stripErdBlock(markdown: string) {
  return markdown.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n");
}
