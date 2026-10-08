"use client";

import "@xyflow/react/dist/style.css";
import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import {
  type Erd,
  type ErdColumn,
  type ErdRelation,
  parseErd,
  replaceErdBlock,
  serializeErd,
} from "@/lib/erd";
import { cn } from "@/lib/utils";
import { saveDocumentDirectAction } from "../actions";

const FROM_SIDE = [
  { value: "||", label: "exactly one" },
  { value: "|o", label: "zero or one" },
  { value: "}|", label: "one or many" },
  { value: "}o", label: "zero or many" },
];
const TO_SIDE = [
  { value: "||", label: "exactly one" },
  { value: "o|", label: "zero or one" },
  { value: "|{", label: "one or many" },
  { value: "o{", label: "zero or many" },
];
const short = (side: string) =>
  side.includes("{") || side.includes("}") ? "many" : "1";

type TableData = { name: string; columns: ErdColumn[]; selected: boolean };

function TableNode({ data }: NodeProps<Node<TableData>>) {
  return (
    <div
      className={cn(
        "min-w-52 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        data.selected && "border-primary ring-2 ring-primary/30",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !bg-primary"
      />
      <div className="border-b bg-muted/60 px-3 py-2 font-mono text-xs font-semibold">
        {data.name}
      </div>
      <ul className="py-1 text-xs">
        {data.columns.length === 0 && (
          <li className="px-3 py-1 text-muted-foreground">No columns</li>
        )}
        {data.columns.map((c) => (
          <li key={c.name} className="flex items-center gap-2 px-3 py-1">
            <span className="w-4 shrink-0 text-primary">
              {c.keys.includes("PK") ? (
                <KeyRound className="size-3" />
              ) : c.keys.includes("FK") ? (
                <Link2 className="size-3" />
              ) : null}
            </span>
            <span className="flex-1 font-mono">{c.name}</span>
            <span className="font-mono text-muted-foreground">{c.type}</span>
          </li>
        ))}
      </ul>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !bg-primary"
      />
    </div>
  );
}
const nodeTypes = { table: TableNode };

/** Editable ERD: drag, add/rename tables and columns, draw relationships; saved into the document. */
export function ErdCanvas({
  doc,
  canEdit,
}: {
  doc: { id: string; content: string; currentVersion: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [erd, setErd] = useState<Erd>(() => parseErd(doc.content));
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<
    { kind: "table"; name: string } | { kind: "relation"; index: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const update = (fn: (e: Erd) => Erd) => {
    setErd((e) => fn(structuredClone(e)));
    setDirty(true);
  };

  const nodes: Node<TableData>[] = useMemo(
    () =>
      erd.tables.map((t, i) => ({
        id: t.name,
        type: "table",
        position: erd.layout[t.name] ?? {
          x: (i % 3) * 300,
          y: Math.floor(i / 3) * 260,
        },
        data: {
          name: t.name,
          columns: t.columns,
          selected: selected?.kind === "table" && selected.name === t.name,
        },
      })),
    [erd, selected],
  );
  const edges: Edge[] = useMemo(
    () =>
      erd.relations.map((r, i) => ({
        id: `r${i}`,
        source: r.from,
        target: r.to,
        label: `${short(r.left)} → ${short(r.right)}${r.label ? ` · ${r.label}` : ""}`,
        animated: !r.identifying,
        style: {
          stroke:
            selected?.kind === "relation" && selected.index === i
              ? "var(--primary)"
              : "var(--muted-foreground)",
          strokeWidth: 1.5,
        },
        labelBgStyle: { fill: "var(--card)" },
        labelStyle: { fill: "var(--foreground)", fontSize: 11 },
      })),
    [erd, selected],
  );

  const onNodesChange = (changes: NodeChange<Node<TableData>>[]) => {
    const moved = applyNodeChanges(changes, nodes);
    if (!changes.some((c) => c.type === "position")) return;
    setErd((e) => ({
      ...e,
      layout: Object.fromEntries(moved.map((n) => [n.id, n.position])),
    }));
    setDirty(true);
  };

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target) return;
    update((e) => {
      e.relations.push({
        from: c.source,
        to: c.target,
        left: "||",
        right: "o{",
        identifying: true,
        label: "has",
      });
      return e;
    });
    setSelected({ kind: "relation", index: erd.relations.length });
  };

  const addTable = () => {
    let n = erd.tables.length + 1;
    while (erd.tables.some((t) => t.name === `TABLE_${n}`)) n++;
    const name = `TABLE_${n}`;
    update((e) => {
      e.tables.push({
        name,
        columns: [{ type: "uuid", name: "id", keys: ["PK"] }],
      });
      return e;
    });
    setSelected({ kind: "table", name });
  };

  const save = () =>
    start(async () => {
      setError(null);
      const content = replaceErdBlock(doc.content, serializeErd(erd));
      const res = await saveDocumentDirectAction({
        id: doc.id,
        baseVersion: doc.currentVersion,
        content,
        note: "Edited the data model",
      });
      if (!res.ok) return setError(res.error ?? "Couldn't save");
      setDirty(false);
      router.refresh();
    });

  const table =
    selected?.kind === "table"
      ? erd.tables.find((t) => t.name === selected.name)
      : undefined;
  const relation =
    selected?.kind === "relation" ? erd.relations[selected.index] : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Data model</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-warning">Unsaved changes</span>
            )}
            <Button variant="outline" size="sm" onClick={addTable}>
              <Plus />
              Add table
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setErd(parseErd(doc.content));
                  setDirty(false);
                  setSelected(null);
                }}
              >
                Discard
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : `Save as v${doc.currentVersion + 1}`}
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-[560px] overflow-hidden rounded-2xl border bg-background">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={canEdit ? onConnect : undefined}
            onNodeClick={(_, n) => setSelected({ kind: "table", name: n.id })}
            onEdgeClick={(_, e) =>
              setSelected({ kind: "relation", index: Number(e.id.slice(1)) })
            }
            onPaneClick={() => setSelected(null)}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="rounded-2xl border bg-card p-4 text-sm">
          {!selected && (
            <p className="text-muted-foreground">
              {canEdit
                ? "Drag tables to arrange them. Click a table or a relationship to edit it. Drag from a table's right dot to another table to relate them."
                : "Drag the canvas and zoom to explore. Click a table or relationship for details."}
            </p>
          )}
          {table && (
            <TablePanel
              key={table.name}
              table={table}
              canEdit={canEdit}
              taken={erd.tables.map((t) => t.name)}
              onChange={(next) => {
                update((e) => {
                  const i = e.tables.findIndex((t) => t.name === table.name);
                  e.tables[i] = next;
                  if (next.name !== table.name) {
                    for (const r of e.relations) {
                      if (r.from === table.name) r.from = next.name;
                      if (r.to === table.name) r.to = next.name;
                    }
                    if (e.layout[table.name]) {
                      e.layout[next.name] = e.layout[table.name];
                      delete e.layout[table.name];
                    }
                  }
                  return e;
                });
                if (next.name !== table.name)
                  setSelected({ kind: "table", name: next.name });
              }}
              onDelete={() => {
                update((e) => ({
                  ...e,
                  tables: e.tables.filter((t) => t.name !== table.name),
                  relations: e.relations.filter(
                    (r) => r.from !== table.name && r.to !== table.name,
                  ),
                }));
                setSelected(null);
              }}
            />
          )}
          {relation && selected?.kind === "relation" && (
            <RelationPanel
              relation={relation}
              canEdit={canEdit}
              onChange={(next) =>
                update((e) => {
                  e.relations[selected.index] = next;
                  return e;
                })
              }
              onDelete={() => {
                update((e) => {
                  e.relations.splice(selected.index, 1);
                  return e;
                });
                setSelected(null);
              }}
            />
          )}
        </aside>
      </div>
    </section>
  );
}

function TablePanel({
  table,
  canEdit,
  taken,
  onChange,
  onDelete,
}: {
  table: { name: string; columns: ErdColumn[] };
  canEdit: boolean;
  taken: string[];
  onChange: (t: { name: string; columns: ErdColumn[] }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(table.name);
  const clean = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_-]/g, "");
  const setCol = (i: number, patch: Partial<ErdColumn>) =>
    onChange({
      ...table,
      columns: table.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  const toggleKey = (i: number, key: string) => {
    const keys = table.columns[i].keys;
    setCol(i, {
      keys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    });
  };

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono font-semibold">{table.name}</p>
        {table.columns.map((c) => (
          <p key={c.name} className="font-mono text-xs">
            {c.name} <span className="text-muted-foreground">{c.type}</span>{" "}
            {c.keys.join(",")}
            {c.comment && (
              <span className="block font-sans text-muted-foreground">
                {c.comment}
              </span>
            )}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Table name</span>
        <Input
          value={name}
          aria-label="Table name"
          className="font-mono"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = clean(name);
            if (!next || (next !== table.name && taken.includes(next)))
              return setName(table.name);
            setName(next);
            if (next !== table.name) onChange({ ...table, name: next });
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Columns</span>
        {table.columns.map((c, i) => (
          <div
            key={c.name}
            className="flex flex-col gap-1.5 rounded-lg border p-2"
          >
            <div className="flex gap-1.5">
              <Input
                defaultValue={c.name}
                aria-label="Column name"
                className="h-7 font-mono text-xs"
                onBlur={(e) => {
                  const v = clean(e.target.value);
                  if (!v || table.columns.some((o) => o.name === v)) {
                    e.target.value = c.name; // empty or duplicate: revert
                    return;
                  }
                  setCol(i, { name: v });
                }}
              />
              <Input
                defaultValue={c.type}
                aria-label="Column type"
                className="h-7 w-24 font-mono text-xs"
                onBlur={(e) => {
                  const v = clean(e.target.value);
                  if (v && v !== c.type) setCol(i, { type: v });
                }}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${c.name}`}
                onClick={() =>
                  onChange({
                    ...table,
                    columns: table.columns.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex gap-1">
              {["PK", "FK", "UK"].map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={c.keys.includes(k)}
                  onClick={() => toggleKey(i, k)}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
                    c.keys.includes(k)
                      ? "border-primary bg-primary/15 text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            let n = table.columns.length + 1;
            while (table.columns.some((c) => c.name === `column_${n}`)) n++;
            onChange({
              ...table,
              columns: [
                ...table.columns,
                { type: "string", name: `column_${n}`, keys: [] },
              ],
            });
          }}
        >
          <Plus />
          Add column
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 />
        Delete table
      </Button>
    </div>
  );
}

function RelationPanel({
  relation,
  canEdit,
  onChange,
  onDelete,
}: {
  relation: ErdRelation;
  canEdit: boolean;
  onChange: (r: ErdRelation) => void;
  onDelete: () => void;
}) {
  const describe = `Each ${relation.from} has ${TO_SIDE.find((o) => o.value === relation.right)?.label ?? relation.right} ${relation.to}.`;
  if (!canEdit) return <p>{describe}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-xs">
        {relation.from} → {relation.to}
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {relation.from} side
        </span>
        <OptionSelect
          label={`${relation.from} side`}
          value={relation.left}
          options={FROM_SIDE}
          onValueChange={(v) => onChange({ ...relation, left: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {relation.to} side
        </span>
        <OptionSelect
          label={`${relation.to} side`}
          value={relation.right}
          options={TO_SIDE}
          onValueChange={(v) => onChange({ ...relation, right: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input
          defaultValue={relation.label}
          aria-label="Relationship label"
          onBlur={(e) =>
            onChange({ ...relation, label: e.target.value.trim() })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">{describe}</p>
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 />
        Delete relationship
      </Button>
    </div>
  );
}
