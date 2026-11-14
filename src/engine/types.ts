import type { Graph } from "./graph";
export type Effect =
  "aurora" | "pulse" | "spectrum" | "ember" | "ocean" | "screen";
export type Layout = "arch" | "strip" | "matrix" | "helix";
export type Source = "demo" | "microphone" | "screen";
export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface Features {
  bands: number[];
  bass: number;
  mid: number;
  high: number;
  rms: number;
  beat: number;
  bpm: number;
  capturedAt: number;
}
export interface Layer {
  effect: Effect;
  gain: number;
  audio: boolean;
}
export interface Clip {
  id: string;
  name: string;
  start: number;
  duration: number;
  effect: Effect;
  palette: number;
}
export interface Scene {
  version: 1;
  name: string;
  effect: Effect;
  palette: number;
  brightness: number;
  speed: number;
  spread: number;
  sensitivity: number;
  count: number;
  layout: Layout;
  source: Source;
  playing: boolean;
  timelineEnabled: boolean;
  duration: number;
  clips: Clip[];
  layers: Layer[];
  customPoints?: Point[];
  graph?: Graph;
}
export interface Controller {
  id: string;
  name: string;
  host: string;
  count: number;
  offset: number;
  protocol: "ddp" | "dnrgb";
  enabled: boolean;
  latencyMs: number;
  budgetKbps: number;
}
export interface DeviceStats {
  id: string;
  sent: number;
  dropped: number;
  fps: number;
  sendMs: number;
  status: string;
}
export interface Telemetry {
  fps: number;
  renderMs: number;
  audioAgeMs: number;
  elapsed: number;
  frames: number;
  dropped: number;
  backend: string;
  features: Features;
  devices: DeviceStats[];
  rttMs: number | null;
}
export const emptyFeatures = (): Features => ({
  bands: Array(48).fill(0),
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  beat: 0,
  bpm: 0,
  capturedAt: 0,
});
export const defaultScene: Scene = {
  version: 1,
  name: "Северное сияние",
  effect: "aurora",
  palette: 0,
  brightness: 0.72,
  speed: 0.65,
  spread: 0.6,
  sensitivity: 1,
  count: 240,
  layout: "arch",
  source: "demo",
  playing: true,
  timelineEnabled: false,
  duration: 32,
  layers: [{ effect: "aurora", gain: 1, audio: true }],
  clips: [
    {
      id: "c1",
      name: "Северное сияние",
      start: 0,
      duration: 12,
      effect: "aurora",
      palette: 0,
    },
    {
      id: "c2",
      name: "Глубокий океан",
      start: 12,
      duration: 10,
      effect: "ocean",
      palette: 2,
    },
    {
      id: "c3",
      name: "Пульс",
      start: 22,
      duration: 10,
      effect: "pulse",
      palette: 1,
    },
  ],
};
