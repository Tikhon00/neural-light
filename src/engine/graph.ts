import type { Effect, Layer } from "./types";
export interface GraphNode {
  id: string;
  kind: "audio" | "effect" | "gain" | "output";
  effect?: Effect;
  gain?: number;
  x: number;
  y: number;
  selected?: boolean;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export const defaultGraph: Graph = {
  nodes: [
    { id: "audio", kind: "audio", x: 25, y: 150 },
    { id: "effect", kind: "effect", effect: "aurora", x: 275, y: 150 },
    { id: "output", kind: "output", x: 525, y: 150 },
  ],
  edges: [
    { id: "a-e", source: "audio", target: "effect" },
    { id: "e-o", source: "effect", target: "output" },
  ],
};
export function compileGraph(graph: Graph): Layer[] {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    throw new Error("Некорректный граф");
  if (graph.nodes.length > 32 || graph.edges.length > 64)
    throw new Error("Максимум 32 узла и 64 связи");
  const effects = ["aurora", "pulse", "spectrum", "ember", "ocean", "screen"];
  if (
    !graph.nodes.every(
      (n) =>
        n &&
        typeof n.id === "string" &&
        n.id.length <= 100 &&
        ["audio", "effect", "gain", "output"].includes(n.kind) &&
        Number.isFinite(n.x) &&
        Number.isFinite(n.y) &&
        (n.kind !== "effect" || effects.includes(n.effect || "")) &&
        (n.kind !== "gain" ||
          (typeof n.gain === "number" &&
            Number.isFinite(n.gain) &&
            n.gain >= 0 &&
            n.gain <= 1)),
    )
  )
    throw new Error("Некорректные параметры узла");
  if (
    !graph.edges.every(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.source === "string" &&
        typeof e.target === "string",
    )
  )
    throw new Error("Некорректная связь");
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  if (nodes.size !== graph.nodes.length)
    throw new Error("ID узлов должны быть уникальными");
  const outputs = graph.nodes.filter((n) => n.kind === "output");
  if (outputs.length !== 1) throw new Error("Нужен ровно один выход LED");
  const active = new Set<string>(),
    visited = new Set<string>();
  for (const edge of graph.edges) {
    const a = nodes.get(edge.source),
      b = nodes.get(edge.target);
    if (
      !a ||
      !b ||
      a.kind === "output" ||
      b.kind === "audio" ||
      (a.kind === "audio" && b.kind !== "effect") ||
      (b.kind === "effect" && a.kind !== "audio")
    )
      throw new Error("Соедините звук → эффект → яркость или LED");
  }
  const visit = (id: string): void => {
    if (active.has(id))
      throw new Error("Цикл в графе: удалите замыкающую связь");
    if (visited.has(id)) return;
    active.add(id);
    graph.edges.filter((e) => e.target === id).forEach((e) => visit(e.source));
    active.delete(id);
    visited.add(id);
  };
  graph.nodes.forEach((n) => visit(n.id));
  let paths = 0;
  const walk = (id: string, gain: number): Layer[] => {
    const node = nodes.get(id)!;
    if (node.kind === "effect") {
      if (++paths > 4) throw new Error("Максимум четыре слоя света на выходе");
      return [
        {
          effect: node.effect || "aurora",
          gain,
          audio: graph.edges.some(
            (e) => e.target === id && nodes.get(e.source)?.kind === "audio",
          ),
        },
      ];
    }
    if (node.kind === "audio") return [];
    return graph.edges
      .filter((e) => e.target === id)
      .flatMap((e) =>
        walk(
          e.source,
          gain *
            (node.kind === "gain"
              ? Math.max(0, Math.min(1, node.gain ?? 1))
              : 1),
        ),
      );
  };
  const result = walk(outputs[0].id, 1);
  if (result.length > 4)
    throw new Error("Максимум четыре слоя света на выходе");
  return result;
}
export function graphFromLayers(layers: Layer[]): Graph {
  const graph: Graph = {
    nodes: [
      { id: "audio", kind: "audio", x: 20, y: 130 },
      { id: "output", kind: "output", x: 730, y: 130 },
    ],
    edges: [],
  };
  layers.forEach((layer, i) => {
    const id = `effect-${i}`,
      gain = `gain-${i}`,
      y = 50 + i * 170;
    graph.nodes.push({ id, kind: "effect", effect: layer.effect, x: 255, y });
    if (layer.audio)
      graph.edges.push({ id: `a-${i}`, source: "audio", target: id });
    if (layer.gain !== 1) {
      graph.nodes.push({ id: gain, kind: "gain", gain: layer.gain, x: 495, y });
      graph.edges.push({ id: `g-${i}`, source: id, target: gain });
    }
    graph.edges.push({
      id: `o-${i}`,
      source: layer.gain !== 1 ? gain : id,
      target: "output",
    });
  });
  return graph;
}
