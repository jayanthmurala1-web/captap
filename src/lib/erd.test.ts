import { expect, test } from "vitest";
import { parseErd, replaceErdBlock, serializeErd, stripErdBlock } from "./erd";

const doc = `# Data model

Intro text stays.

\`\`\`mermaid
erDiagram
  ORGANIZATION ||--o{ PROJECT : contains
  PROJECT ||--o{ TASK : "tracks work"
  TASK }o..o| USER : assigned

  ORGANIZATION {
    string id PK
    string name
  }

  PROJECT {
    uuid id PK
    string orgId FK "owning org"
    string slug UK
  }
\`\`\`

Outro text stays too.
`;

test("parses tables, columns (keys, comments), relations with both cardinalities", () => {
  const erd = parseErd(doc);
  expect(erd.tables.map((t) => t.name)).toEqual([
    "ORGANIZATION",
    "PROJECT",
    "TASK",
    "USER",
  ]);
  const project = erd.tables.find((t) => t.name === "PROJECT");
  expect(project?.columns).toEqual([
    { type: "uuid", name: "id", keys: ["PK"] },
    { type: "string", name: "orgId", keys: ["FK"], comment: "owning org" },
    { type: "string", name: "slug", keys: ["UK"] },
  ]);
  expect(erd.relations).toEqual([
    {
      from: "ORGANIZATION",
      to: "PROJECT",
      left: "||",
      right: "o{",
      identifying: true,
      label: "contains",
    },
    {
      from: "PROJECT",
      to: "TASK",
      left: "||",
      right: "o{",
      identifying: true,
      label: "tracks work",
    },
    {
      from: "TASK",
      to: "USER",
      left: "}o",
      right: "o|",
      identifying: false,
      label: "assigned",
    },
  ]);
});

test("serialize → parse is lossless, and the layout travels with the diagram", () => {
  const erd = parseErd(doc);
  erd.layout = { ORGANIZATION: { x: 10, y: 20 }, PROJECT: { x: 320, y: 20 } };
  const again = parseErd(serializeErd(erd));
  expect(again).toEqual(erd);
  expect(serializeErd(again)).toBe(serializeErd(erd));
});

test("saving replaces only the diagram block; a doc without one gets it appended", () => {
  const erd = parseErd(doc);
  erd.tables.push({
    name: "INVOICE",
    columns: [{ type: "uuid", name: "id", keys: ["PK"] }],
  });
  const updated = replaceErdBlock(doc, serializeErd(erd));
  expect(updated).toContain("Intro text stays.");
  expect(updated).toContain("Outro text stays too.");
  expect(updated.match(/```mermaid/g)).toHaveLength(1);
  expect(parseErd(updated).tables.map((t) => t.name)).toContain("INVOICE");

  const plain = replaceErdBlock(
    "# Data model\n\nNothing yet.",
    serializeErd(erd),
  );
  expect(plain).toContain("Nothing yet.");
  expect(parseErd(plain).tables).toHaveLength(5);
});

test("an empty or missing diagram parses to an empty model", () => {
  expect(parseErd("# No diagram here")).toEqual({
    tables: [],
    relations: [],
    layout: {},
  });
});

test("the read view drops only the diagram source, keeping the prose", () => {
  const out = stripErdBlock(doc);
  expect(out).not.toContain("erDiagram");
  expect(out).toContain("Intro text stays.");
  expect(out).toContain("Outro text stays too.");
});
