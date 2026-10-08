"use client";

import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TaskRole } from "@/db/schema";
import { saveRoleRoutesAction } from "./actions";
import { AgentDialog, type AgentNodeData } from "./agent-dialog";
import { AgentNodeView, RoleNodeView } from "./flow-nodes";

const nodeTypes = { agentNode: AgentNodeView, roleNode: RoleNodeView };

const ROLE_LABEL: Record<TaskRole, string> = {
  product: "Product",
  developer: "Developer",
  qa: "QA",
  devops: "DevOps",
};

const ROW = 70;
const skillNodeId = (name: string) => `skill:${name}`;
const roleNodeId = (role: TaskRole) => `role:${role}`;

const agentNode = (a: AgentNodeData, i: number): Node => ({
  id: skillNodeId(a.name),
  type: "agentNode",
  position: { x: 0, y: i * ROW },
  data: { label: a.name, kind: a.kind },
});

export function FlowCanvas({
  agents,
  roles,
  routes,
  canEdit,
}: {
  agents: AgentNodeData[];
  roles: TaskRole[];
  routes: { role: TaskRole; skillName: string }[];
  canEdit: boolean;
}) {
  const [agentsState, setAgentsState] = useState(agents);

  // biome-ignore lint/correctness/useExhaustiveDependencies: agentsState is the initial snapshot only — useNodesState owns `nodes` after this, later add/edit/remove mutate it directly.
  const initialNodes = useMemo<Node[]>(() => {
    const skillNodes = agentsState.map(agentNode);
    const roleNodes: Node[] = roles.map((r, i) => ({
      id: roleNodeId(r),
      type: "roleNode",
      position: { x: 420, y: i * ROW },
      data: { label: ROLE_LABEL[r], role: r },
    }));
    return [...skillNodes, ...roleNodes];
  }, [roles]);

  // Only routes whose agent actually exists as a node: the defaults name skills ("deployment",
  // "ci-cd") a blank org hasn't added, and a dangling edge would otherwise get saved as a route to
  // nothing. A later Save also sheds any such stale rows.
  const initialEdges = useMemo<Edge[]>(() => {
    const known = new Set(agents.map((a) => a.name));
    return routes
      .filter((r) => known.has(r.skillName))
      .map((r) => ({
        id: `${r.skillName}->${r.role}`,
        source: skillNodeId(r.skillName),
        target: roleNodeId(r.role),
        animated: false,
      }));
  }, [routes, agents]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [routeState, setRouteState] = useState<{
    error?: string;
    ok?: boolean;
  }>();
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{
    open: boolean;
    agent: AgentNodeData | null;
  }>({ open: false, agent: null });

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (!canEdit || !node.id.startsWith("skill:")) return;
      const name = node.id.slice("skill:".length);
      const a = agentsState.find((x) => x.name === name);
      if (a) setDialog({ open: true, agent: a });
    },
    [agentsState, canEdit],
  );

  // Clicking a connection removes it directly — no hidden "select then press Delete" step.
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  const onAgentSaved = (saved: AgentNodeData) => {
    setAgentsState((prev) => {
      const existing = dialog.agent;
      if (existing && !existing.id.startsWith("default-")) {
        return prev.map((a) => (a.id === existing.id ? saved : a));
      }
      // New row (either a brand-new agent, or a default just overridden for the first time).
      const withoutDefault = prev.filter((a) => a.name !== saved.name);
      return [...withoutDefault, saved];
    });
    if (!dialog.agent) {
      setNodes((nds) => [...nds, agentNode(saved, agentsState.length)]);
    }
  };

  const onAgentRemoved = (removed: AgentNodeData) => {
    setAgentsState((prev) => prev.filter((a) => a.id !== removed.id));
    setNodes((nds) => nds.filter((n) => n.id !== skillNodeId(removed.name)));
    setEdges((eds) =>
      eds.filter((e) => e.source !== skillNodeId(removed.name)),
    );
  };

  const save = async () => {
    setPending(true);
    setRouteState(undefined);
    const payload = edges
      .map((e) => ({
        skillName: e.source.replace("skill:", ""),
        role: e.target.replace("role:", "") as TaskRole,
      }))
      .filter((r) => roles.includes(r.role));
    const res = await saveRoleRoutesAction(payload);
    setRouteState(res);
    setPending(false);
  };

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={canEdit ? onNodesChange : undefined}
        onEdgesChange={canEdit ? onEdgesChange : undefined}
        onConnect={canEdit ? onConnect : undefined}
        onNodeClick={onNodeClick}
        onEdgeClick={canEdit ? onEdgeClick : undefined}
        nodesConnectable={canEdit}
        nodesDraggable={canEdit}
        elementsSelectable={canEdit}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      {canEdit && (
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {routeState?.error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
              {routeState.error}
            </p>
          )}
          {routeState?.ok && (
            <p className="rounded-lg bg-success/10 px-3 py-1.5 text-sm text-success">
              Saved
            </p>
          )}
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save routing"}
          </Button>
        </div>
      )}
      {canEdit && (
        <Button
          onClick={() => setDialog({ open: true, agent: null })}
          className="absolute top-4 left-1/2 -translate-x-1/2"
          variant="outline"
        >
          <Plus />
          Add agent
        </Button>
      )}
      <AgentDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        agent={dialog.agent}
        onSaved={onAgentSaved}
        onRemoved={onAgentRemoved}
      />
    </div>
  );
}
