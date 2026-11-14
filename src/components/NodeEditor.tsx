import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeProps,
  type Node,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AudioLines, Sparkles, Sun, Cable, Plus } from "lucide-react";
import { compileGraph, type Graph, type GraphNode } from "../engine/graph";
import { presets } from "../engine/presets";
import type { Effect } from "../engine/types";
type FlowNode = Node<{
  node: GraphNode;
  change: (patch: Partial<GraphNode>) => void;
}>;
const icons = { audio: AudioLines, effect: Sparkles, gain: Sun, output: Cable };
const labels = {
  audio: "Аудиосигнал",
  effect: "Эффект",
  gain: "Яркость слоя",
  output: "Выход LED",
};
function LightNode({ data }: NodeProps<FlowNode>) {
  const node = data.node,
    Icon = icons[node.kind];
  return (
    <div className="light-node">
      {node.kind !== "audio" && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="node-heading">
        <Icon size={16} />
        <strong>{labels[node.kind]}</strong>
      </div>
      {node.kind === "effect" ? (
        <select
          className="nodrag"
          aria-label="Эффект узла"
          value={node.effect}
          onChange={(e) => data.change({ effect: e.target.value as Effect })}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : node.kind === "gain" ? (
        <label className="node-gain">
          {Math.round((node.gain ?? 1) * 100)}%
          <input
            className="nodrag"
            aria-label="Яркость слоя"
            type="range"
            min={0}
            max={1}
            step=".01"
            value={node.gain ?? 1}
            onChange={(e) => data.change({ gain: Number(e.target.value) })}
          />
        </label>
      ) : (
        <p>
          {node.kind === "audio"
            ? "FFT · низкие / средние / высокие"
            : "Суммирование до четырёх слоёв"}
        </p>
      )}
      {node.kind !== "output" && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
const nodeTypes = { light: LightNode };
export function NodeEditor({
  graph,
  onChange,
  error,
}: {
  graph: Graph;
  onChange: (graph: Graph) => void;
  error: (message: string) => void;
}) {
  const nodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "light",
        position: { x: n.x, y: n.y },
        selected: n.selected,
        deletable: n.kind !== "output",
        data: {
          node: n,
          change: (patch) =>
            onChange({
              ...graph,
              nodes: graph.nodes.map((item) =>
                item.id === n.id ? { ...item, ...patch } : item,
              ),
            }),
        },
      })),
    [graph, onChange],
  );
  const changeNodes = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const edits = changes.filter((c) => c.type !== "dimensions");
      if (edits.length === 0) return;
      const next = applyNodeChanges(edits, nodes);
      onChange({
        nodes: next.map((n) => ({
          ...n.data.node,
          x: n.position.x,
          y: n.position.y,
          selected: n.selected,
        })),
        edges: graph.edges.filter(
          (e) =>
            next.some((n) => n.id === e.source) &&
            next.some((n) => n.id === e.target),
        ),
      });
    },
    [nodes, graph, onChange],
  );
  const changeEdges = (changes: EdgeChange[]) =>
    onChange({ ...graph, edges: applyEdgeChanges(changes, graph.edges) });
  const connect = (c: Connection) => {
    if (graph.edges.some((e) => e.source === c.source && e.target === c.target))
      return;
    const next = {
      ...graph,
      edges: [
        ...graph.edges,
        { id: crypto.randomUUID(), source: c.source, target: c.target },
      ],
    };
    try {
      compileGraph(next);
      onChange(next);
    } catch (e) {
      error((e as Error).message);
    }
  };
  return (
    <section className="graph-panel">
      <div className="panel-heading">
        <div>
          <h2>Из звука в свет</h2>
          <span className="muted">
            Соединяйте порты. Выберите связь и нажмите Backspace, чтобы удалить.
          </span>
        </div>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() =>
              onChange({
                ...graph,
                nodes: [
                  ...graph.nodes,
                  {
                    id: crypto.randomUUID(),
                    kind: "effect",
                    effect: "ocean",
                    x: 275,
                    y: 330,
                  },
                ],
              })
            }
          >
            <Plus size={14} /> Эффект
          </button>
          <button
            className="secondary"
            onClick={() =>
              onChange({
                ...graph,
                nodes: [
                  ...graph.nodes,
                  {
                    id: crypto.randomUUID(),
                    kind: "gain",
                    gain: 0.5,
                    x: 450,
                    y: 330,
                  },
                ],
              })
            }
          >
            <Plus size={14} /> Яркость
          </button>
        </div>
      </div>
      <div className="graph-canvas">
        <ReactFlow
          colorMode="dark"
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={changeNodes}
          onEdgesChange={changeEdges}
          onConnect={connect}
          fitView
          minZoom={0.3}
          maxZoom={1.4}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "#7cbaa7", strokeWidth: 1.5 },
          }}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="graph-caption">
        Неподключённый эффект не выводится на LED. Без связи со звуком эффект
        работает автономно.
      </p>
    </section>
  );
}
