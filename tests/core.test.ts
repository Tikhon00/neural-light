import { describe, expect, it } from "vitest";
import { AudioAnalyzer, demoPCM } from "../src/engine/dsp";
import { makeMapping, validatePoints } from "../src/engine/mapping";
import { compileGraph, defaultGraph } from "../src/engine/graph";
import { renderFrame, sceneAt } from "../src/engine/effects";
import { parseScene } from "../src/engine/presets";
import { defaultScene, emptyFeatures } from "../src/engine/types";

describe("DSP uses real PCM", () => {
  it("resolves a low-frequency sine and silence", () => {
    const analyzer = new AudioAnalyzer();
    const pcm = Float32Array.from(
      { length: 2048 },
      (_, i) => Math.sin((2 * Math.PI * 93.75 * i) / 48000) * 0.5,
    );
    const f = analyzer.analyze(pcm, 48000, 1);
    expect(f.bass).toBeGreaterThan(0.9);
    expect(f.high).toBeLessThan(0.001);
    expect(f.rms).toBeCloseTo(Math.sqrt(0.125), 2);
    const silent = analyzer.analyze(new Float32Array(2048), 48000, 2);
    expect(silent.bands.every((v) => v === 0)).toBe(true);
    expect(silent.rms).toBe(0);
  });
  it("detects the generated 120 BPM beat", () => {
    const analyzer = new AudioAnalyzer(),
      pcm = new Float32Array(2048),
      bpms = [];
    for (let i = 0; i < 600; i++) {
      demoPCM(pcm, i / 60);
      const f = analyzer.analyze(pcm, 48000, i / 60);
      if (i > 300 && f.bpm) bpms.push(f.bpm);
    }
    expect(bpms.some((bpm) => Math.abs(bpm - 120) < 5)).toBe(true);
  });
  it("rejects invalid FFT sizes", () =>
    expect(() => new AudioAnalyzer(1000)).toThrow());
});
describe("scene safety and evaluation", () => {
  it("round-trips a scene and rejects untrusted values", () => {
    expect(parseScene(JSON.parse(JSON.stringify(defaultScene)))).toEqual(
      defaultScene,
    );
    for (const patch of [
      { count: 999999 },
      { speed: Infinity },
      { palette: -1 },
      { layers: [{ effect: "code", gain: 1 }] },
      { customPoints: [{ x: 0, y: 0, z: 0 }] },
    ])
      expect(() => parseScene({ ...defaultScene, ...patch })).toThrow();
  });
  it("switches timeline clips at exact boundaries and renders gaps black", () => {
    const scene = { ...defaultScene, timelineEnabled: true };
    expect(sceneAt(scene, 11.999).effect).toBe("aurora");
    expect(sceneAt(scene, 12).effect).toBe("ocean");
    expect(sceneAt(scene, 32).effect).toBe("aurora");
    expect(sceneAt({ ...scene, clips: [] }, 5).layers).toEqual([]);
  });
  it("renders bounded RGB and honors blackout", () => {
    const points = makeMapping("arch", 240),
      output = new Uint8Array(720);
    renderFrame(defaultScene, points, emptyFeatures(), 1, output);
    expect(output.some((v) => v > 0)).toBe(true);
    renderFrame(
      { ...defaultScene, brightness: 0 },
      points,
      emptyFeatures(),
      1,
      output,
    );
    expect(output.every((v) => v === 0)).toBe(true);
    renderFrame(
      { ...defaultScene, layers: [] },
      points,
      emptyFeatures(),
      1,
      output,
    );
    expect(output.every((v) => v === 0)).toBe(true);
  });
});
describe("mapping and graph execution", () => {
  it("maps arbitrary LED counts without NaNs", () => {
    for (const layout of ["arch", "strip", "matrix", "helix"] as const)
      for (const count of [1, 17, 240, 8192])
        expect(validatePoints(makeMapping(layout, count), count)).toBe(true);
    expect(() => makeMapping("strip", 8193)).toThrow();
  });
  it("compiles only connected effects", () => {
    expect(compileGraph(defaultGraph)).toEqual([
      { effect: "aurora", gain: 1, audio: true },
    ]);
    expect(compileGraph({ ...defaultGraph, edges: [] })).toEqual([]);
    expect(
      compileGraph({ ...defaultGraph, edges: [defaultGraph.edges[1]] })[0]
        .audio,
    ).toBe(false);
  });
  it("rejects cycles and invalid port types", () => {
    const graph = structuredClone(defaultGraph);
    graph.nodes.push({ id: "g", kind: "gain", gain: 0.5, x: 0, y: 0 });
    graph.edges.push({ id: "cycle", source: "g", target: "g" });
    expect(() => compileGraph(graph)).toThrow("Цикл");
    expect(() =>
      compileGraph({
        ...defaultGraph,
        edges: [{ id: "invalid", source: "audio", target: "output" }],
      }),
    ).toThrow();
  });
  it("applies gain to an executed path", () => {
    const graph = structuredClone(defaultGraph);
    graph.nodes.push({ id: "gain", kind: "gain", gain: 0.25, x: 0, y: 0 });
    graph.edges = [
      graph.edges[0],
      { id: "e-g", source: "effect", target: "gain" },
      { id: "g-o", source: "gain", target: "output" },
    ];
    expect(compileGraph(graph)[0].gain).toBe(0.25);
  });
});
