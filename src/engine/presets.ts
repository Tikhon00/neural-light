import { defaultScene, type Effect, type Scene } from "./types";
import { compileGraph } from "./graph";
export const presets: {
  id: Effect;
  name: string;
  description: string;
  category: string;
  palette: number;
  speed: number;
}[] = [
  {
    id: "aurora",
    name: "Северное сияние",
    description: "Плавные волны, которые чувствуют музыку",
    category: "Атмосфера",
    palette: 0,
    speed: 0.65,
  },
  {
    id: "pulse",
    name: "В ритме",
    description: "Мягкие импульсы на каждый удар",
    category: "Аудиореактивный",
    palette: 1,
    speed: 0.8,
  },
  {
    id: "ocean",
    name: "Глубокий океан",
    description: "Медленное течение холодного света",
    category: "Атмосфера",
    palette: 2,
    speed: 0.35,
  },
  {
    id: "ember",
    name: "Живой огонь",
    description: "Тёплое мерцание тлеющих углей",
    category: "Атмосфера",
    palette: 3,
    speed: 0.7,
  },
  {
    id: "spectrum",
    name: "Спектр",
    description: "Каждая частота становится цветом",
    category: "Аудиореактивный",
    palette: 0,
    speed: 0.8,
  },
  {
    id: "screen",
    name: "За экраном",
    description: "Свет продолжает цвет вашего экрана",
    category: "Захват экрана",
    palette: 2,
    speed: 0.3,
  },
];
export function applyPreset(scene: Scene, effect: Effect): Scene {
  const p = presets.find((p) => p.id === effect)!;
  return {
    ...scene,
    name: p.name,
    effect,
    palette: p.palette,
    speed: p.speed,
    layers: [{ effect, gain: 1, audio: true }],
    graph: undefined,
    timelineEnabled: false,
  };
}
const effects = presets.map((p) => p.id);
const finite = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function parseScene(value: unknown): Scene {
  const s = value as Scene;
  if (
    !s ||
    s.version !== 1 ||
    typeof s.name !== "string" ||
    s.name.length > 100 ||
    !effects.includes(s.effect) ||
    !["arch", "strip", "matrix", "helix"].includes(s.layout) ||
    !["demo", "microphone", "screen"].includes(s.source)
  )
    throw new Error("Неподдерживаемый файл сцены");
  if (
    !finite(s.count, 1, 8192) ||
    !Number.isInteger(s.count) ||
    !finite(s.palette, 0, 3) ||
    !Number.isInteger(s.palette) ||
    !finite(s.brightness, 0, 1) ||
    !finite(s.speed, 0.05, 3) ||
    !finite(s.spread, 0, 1) ||
    !finite(s.sensitivity, 0, 3) ||
    !finite(s.duration, 1, 3600)
  )
    throw new Error("Параметры сцены вне допустимого диапазона");
  if (
    typeof s.playing !== "boolean" ||
    typeof s.timelineEnabled !== "boolean" ||
    !Array.isArray(s.layers) ||
    s.layers.length > 4 ||
    !s.layers.every(
      (l) =>
        effects.includes(l.effect) &&
        finite(l.gain, 0, 1) &&
        typeof l.audio === "boolean",
    )
  )
    throw new Error("Некорректные слои");
  if (
    !Array.isArray(s.clips) ||
    s.clips.length > 64 ||
    !s.clips.every(
      (c) =>
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        c.name.length <= 100 &&
        effects.includes(c.effect) &&
        Number.isInteger(c.palette) &&
        finite(c.palette, 0, 3) &&
        finite(c.start, 0, s.duration) &&
        finite(c.duration, 0.1, s.duration) &&
        c.start + c.duration <= s.duration + 0.001,
    )
  )
    throw new Error("Некорректный таймлайн");
  if (
    s.customPoints &&
    (s.customPoints.length !== s.count ||
      !s.customPoints.every((p) =>
        ["x", "y", "z"].every((k) => finite(p[k as keyof typeof p], -100, 100)),
      ))
  )
    throw new Error("Некорректный маппинг");
  const result = structuredClone(s);
  if (result.graph) result.layers = compileGraph(result.graph);
  return result;
}
export function loadScene(): Scene {
  try {
    const raw = localStorage.getItem("neural-light.scene.v1");
    if (raw)
      return { ...parseScene(JSON.parse(raw)), source: "demo", playing: true };
  } catch {
    /* a corrupt save must never prevent startup */
  }
  return structuredClone(defaultScene);
}
