import type { Effect, Features, Point, Scene } from "./types";
export const palettes = [
  {
    name: "Полярное сияние",
    colors: ["#66edbe", "#4dbce8", "#b3a3ff", "#f39acc"],
    hue: 0.45,
    range: 0.42,
  },
  {
    name: "Тёплый закат",
    colors: ["#ffb65b", "#fc795a", "#ed557b", "#e8a1bc"],
    hue: 0.04,
    range: 0.12,
  },
  {
    name: "Глубокий океан",
    colors: ["#45e3ca", "#40bce3", "#527fe4", "#8aacf6"],
    hue: 0.48,
    range: 0.18,
  },
  {
    name: "Мягкий янтарь",
    colors: ["#ffe4a3", "#ffbf64", "#ed863d", "#ec563b"],
    hue: 0.08,
    range: 0.06,
  },
];
export function hsv(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
export function evaluateEffect(
  effect: Effect,
  p: Point,
  index: number,
  count: number,
  time: number,
  scene: Scene,
  f: Features,
  screen: number[] = [0.3, 0.6, 0.8],
): number[] {
  const palette = palettes[scene.palette] || palettes[0],
    t = time * scene.speed,
    u = index / Math.max(1, count - 1);
  const bass = Math.min(1, f.bass * scene.sensitivity),
    beat = f.beat * Math.min(2, scene.sensitivity);
  let wave =
      0.5 +
      0.5 *
        Math.sin(p.x * (3 + scene.spread * 7) + p.y * 2 + p.z * 3 - t * 1.2),
    value = 0.45 + wave * 0.4,
    hue = palette.hue + wave * palette.range;
  if (effect === "pulse") {
    value = 0.12 + 0.82 * beat * (1 - Math.abs(u - 0.5));
    hue = palette.hue + u * palette.range;
  }
  if (effect === "spectrum") {
    const b = f.bands[Math.min(47, Math.floor(u * 48))] || 0;
    value = 0.025 + Math.min(1, b * scene.sensitivity * 2);
    hue = palette.hue + u * palette.range;
  }
  if (effect === "ember") {
    wave = 0.5 + 0.5 * Math.sin(p.x * 12 + t * 2 + Math.sin(p.y * 8 - t * 3));
    hue = 0.015 + wave * 0.085;
    value = 0.25 + wave * 0.65 + bass * 0.1;
  }
  if (effect === "ocean") {
    wave =
      0.5 + 0.5 * Math.sin(p.x * 4 + p.z * 3 - t + Math.sin(p.y * 4 + t * 0.6));
    hue = palette.hue + wave * palette.range;
    value = 0.25 + wave * 0.55 + bass * 0.15;
  }
  if (effect === "screen") return screen.map((v) => v * scene.brightness);
  return hsv(
    hue,
    0.62 + 0.18 * wave,
    Math.min(1, value * (0.75 + bass * 0.25)) * scene.brightness,
  );
}
export function sceneAt(scene: Scene, time: number): Scene {
  if (!scene.timelineEnabled) return scene;
  const t = ((time % scene.duration) + scene.duration) % scene.duration;
  const clip = scene.clips.find(
    (c) => t >= c.start && t < c.start + c.duration,
  );
  return clip
    ? {
        ...scene,
        effect: clip.effect,
        palette: clip.palette,
        layers: [{ effect: clip.effect, gain: 1, audio: true }],
      }
    : { ...scene, layers: [] };
}
export function renderFrame(
  scene: Scene,
  points: Point[],
  features: Features,
  time: number,
  output: Uint8Array,
  screen?: number[],
): void {
  const active = sceneAt(scene, time),
    silent = {
      ...features,
      bands: Array(48).fill(0),
      bass: 0,
      mid: 0,
      high: 0,
      beat: 0,
    };
  for (let i = 0; i < points.length; i++) {
    let r = 0,
      g = 0,
      b = 0;
    for (const layer of active.layers) {
      const color = evaluateEffect(
        layer.effect,
        points[i],
        i,
        points.length,
        time,
        active,
        layer.audio ? features : silent,
        screen,
      );
      r += color[0] * layer.gain;
      g += color[1] * layer.gain;
      b += color[2] * layer.gain;
    }
    output[i * 3] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    output[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    output[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
  }
}
