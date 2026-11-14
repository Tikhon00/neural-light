import { useEffect, useRef } from "react";
import { Upload, Trash2, Bookmark, Check } from "lucide-react";
import { presets } from "../engine/presets";
import {
  defaultScene,
  emptyFeatures,
  type Effect,
  type Scene,
} from "../engine/types";
import { makeMapping } from "../engine/mapping";
import { renderFrame } from "../engine/effects";

export function EffectArt({
  effect,
  palette,
  large = false,
}: {
  effect: Effect;
  palette: number;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = large ? 560 : 120,
      h = large ? 320 : 120;
    canvas.width = w;
    canvas.height = h;
    const n = 160;
    const scene = {
      ...defaultScene,
      effect,
      palette,
      count: n,
      brightness: 1,
      layers: [{ effect, gain: 1, audio: true }],
    };
    const rgb = new Uint8Array(n * 3);
    const features = {
      ...emptyFeatures(),
      bass: 0.55,
      beat: 0.9,
      bands: Array.from(
        { length: 48 },
        (_, i) => 0.2 + 0.7 * Math.sin(i * 0.2) ** 2,
      ),
    };
    renderFrame(scene, makeMapping("strip", n), features, 3, rgb);
    ctx.fillStyle = "#0e131a";
    ctx.fillRect(0, 0, w, h);
    const wash = ctx.createRadialGradient(
      w * 0.5,
      h * 0.6,
      0,
      w * 0.5,
      h * 0.6,
      w * 0.6,
    );
    wash.addColorStop(0, `rgba(${rgb[240]},${rgb[241]},${rgb[242]},0.2)`);
    wash.addColorStop(1, "rgba(14,19,26,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    // The cover uses the real effect's RGB output, frozen at a representative moment.
    // Three ribbons show the same light at different depths without animation overhead.
    const ribbons = document.createElement("canvas");
    ribbons.width = w;
    ribbons.height = h;
    const light = ribbons.getContext("2d")!;
    light.lineCap = "round";
    function point(u: number, lane: number) {
      const shift = (lane - 1) * h * 0.12;
      if (effect === "pulse") {
        const angle = u * Math.PI * 1.8 + Math.PI * 0.6;
        return [
          w * 0.5 + Math.cos(angle) * w * (0.19 + lane * 0.045),
          h * 0.5 + Math.sin(angle) * h * (0.21 + lane * 0.06),
        ];
      }
      if (effect === "screen") {
        const angle = u * Math.PI * 2;
        const c = Math.cos(angle),
          s = Math.sin(angle);
        return [
          w * 0.5 +
            Math.sign(c) *
              Math.pow(Math.abs(c), 0.3) *
              w *
              (0.23 + lane * 0.015),
          h * 0.5 +
            Math.sign(s) *
              Math.pow(Math.abs(s), 0.3) *
              h *
              (0.23 + lane * 0.025),
        ];
      }
      const wave =
        effect === "ember"
          ? Math.sin(u * Math.PI) ** 2
          : Math.sin(u * Math.PI * 2 + lane * 0.18);
      return [
        w * (0.1 + u * 0.8),
        h * 0.51 + shift + wave * h * (effect === "ember" ? -0.24 : 0.15),
      ];
    }
    for (let lane = 0; lane < 3; lane++) {
      light.globalAlpha = 0.55 + lane * 0.2;
      light.lineWidth = large ? 2.2 : 1.4;
      for (let i = 1; i < n; i++) {
        const previous = point((i - 1) / (n - 1), lane),
          next = point(i / (n - 1), lane);
        light.strokeStyle = `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
        light.beginPath();
        light.moveTo(previous[0], previous[1]);
        light.lineTo(next[0], next[1]);
        light.stroke();
      }
    }
    ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${large ? 14 : 5}px)`;
    ctx.drawImage(ribbons, 0, 0);
    ctx.filter = `blur(${large ? 4 : 1.5}px)`;
    ctx.drawImage(ribbons, 0, 0);
    ctx.filter = "none";
    ctx.drawImage(ribbons, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }, [effect, palette, large]);
  return (
    <canvas
      ref={ref}
      className={large ? "effect-art large" : "effect-art"}
      aria-hidden="true"
    />
  );
}

export function Scenes({
  select,
  saved,
  restore,
  remove,
  importScene,
  save,
  selectedEffect,
}: {
  select: (effect: Effect) => void;
  saved: Scene[];
  restore: (s: Scene) => void;
  remove: (index: number) => void;
  importScene: () => void;
  save: () => void;
  selectedEffect?: Effect;
}) {
  return (
    <section className="scenes-page library-panel">
      <section aria-labelledby="saved-scenes-title">
        <div className="library-section-heading">
          <h3 id="saved-scenes-title">Мои сцены</h3>
          <button className="text-button" onClick={importScene}>
            <Upload size={16} aria-hidden="true" /> Открыть файл
          </button>
        </div>
        {saved.length ? (
          <div className="library-saved-list">
            {saved.map((s, i) => (
              <div className="library-saved-row" key={i}>
                <button
                  className="library-saved-open"
                  aria-label={`Открыть сцену ${s.name}`}
                  onClick={() => restore(s)}
                >
                  <EffectArt effect={s.effect} palette={s.palette} />
                  <span>{s.name}</span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Удалить сцену ${s.name}`}
                  onClick={() => remove(i)}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="library-empty">
            <p>Сохраните понравившийся свет, чтобы вернуться к нему позже.</p>
            <button className="secondary" onClick={save}>
              <Bookmark size={17} aria-hidden="true" /> Сохранить текущий свет
            </button>
          </div>
        )}
      </section>
      <section className="library-ready" aria-labelledby="ready-scenes-title">
        <div className="library-section-heading">
          <h3 id="ready-scenes-title">Готовые эффекты</h3>
        </div>
        <div className="library-effect-grid">
          {presets.map((p) => (
            <button
              className="library-effect"
              key={p.id}
              onClick={() => select(p.id)}
              aria-label={p.name}
              aria-pressed={selectedEffect === p.id}
            >
              <EffectArt effect={p.id} palette={p.palette} />
              <span className="library-effect-copy">
                <strong>{p.name}</strong>
                <span>{p.description}</span>
              </span>
              {selectedEffect === p.id && (
                <Check
                  size={16}
                  className="library-selected"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
