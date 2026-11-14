import { Plus, Repeat2, SkipBack, Play, Pause } from "lucide-react";
import type { Scene } from "../engine/types";
import type { LightRuntime } from "../runtime/runtime";
import { useState } from "react";
import { presets } from "../engine/presets";
export function Timeline({
  scene,
  update,
  elapsed,
  runtime,
}: {
  scene: Scene;
  update: (s: Partial<Scene>) => void;
  elapsed: number;
  runtime: LightRuntime;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const time = elapsed % scene.duration,
    clip = scene.clips.find((c) => c.id === selected);
  const timecode = `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(Math.floor(time % 60)).padStart(2, "0")}.${String(Math.floor((time % 1) * 10))}`;
  return (
    <section className="timeline">
      <div className="panel-heading">
        <div>
          <h2>Таймлайн</h2>
          <span className="muted">Соберите световую последовательность</span>
        </div>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={scene.timelineEnabled}
            onChange={(e) => update({ timelineEnabled: e.target.checked })}
          />
          <span className="switch" /> Автосмена
        </label>
      </div>
      <div className="timeline-track">
        <div className="track-label">
          <span>Свет</span>
          <small>{scene.clips.length} фрагмента</small>
        </div>
        <div className="track-body">
          <div className="ruler">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i}>{((scene.duration * i) / 8).toFixed(0)}с</span>
            ))}
          </div>
          <div className="clips">
            {scene.clips.map((c) => (
              <button
                key={c.id}
                className={`clip palette-${c.palette} ${selected === c.id ? "clip-selected" : ""}`}
                style={{
                  left: `${(c.start / scene.duration) * 100}%`,
                  width: `${(c.duration / scene.duration) * 100}%`,
                }}
                onClick={() => {
                  setSelected(c.id);
                  runtime.seek(c.start);
                }}
                title={`${c.name}, ${c.start}–${c.start + c.duration} секунд`}
              >
                <span className="clip-mini" />
                <span>{c.name}</span>
                <small>{c.duration}с</small>
              </button>
            ))}
          </div>
          <div
            className="playhead"
            style={{ left: `${(time / scene.duration) * 100}%` }}
          >
            <i />
          </div>
        </div>
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            className="icon-button"
            aria-label="В начало"
            onClick={() => runtime.seek(0)}
          >
            <SkipBack size={16} />
          </button>
          <button
            className="transport-play"
            aria-label={scene.playing ? "Пауза" : "Воспроизвести"}
            onClick={() => update({ playing: !scene.playing })}
          >
            {scene.playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
          </button>
          <output className="timecode">{timecode}</output>
          <span className="duration">/ 00:{scene.duration.toFixed(0)}</span>
        </div>
        <div className="transport-end">
          <Repeat2 size={14} />
          <span>Зациклить</span>
          <button
            className="text-button"
            onClick={() => {
              const start = Math.max(
                0,
                ...scene.clips.map((c) => c.start + c.duration),
              );
              const duration = 8;
              update({
                duration: Math.max(scene.duration, start + duration),
                clips: [
                  ...scene.clips,
                  {
                    id: crypto.randomUUID(),
                    name: presets.find((p) => p.id === scene.effect)!.name,
                    start,
                    duration,
                    effect: scene.effect,
                    palette: scene.palette,
                  },
                ],
              });
            }}
            disabled={scene.clips.length >= 64}
          >
            <Plus size={14} /> Фрагмент
          </button>
        </div>
      </div>
      {clip && (
        <div className="clip-editor">
          <span>{clip.name}</span>
          <label>
            Начало, с
            <input
              type="number"
              min={0}
              max={scene.duration - clip.duration}
              step=".5"
              value={clip.start}
              onChange={(e) => {
                const start = Math.max(
                  0,
                  Math.min(
                    scene.duration - clip.duration,
                    Number(e.target.value),
                  ),
                );
                update({
                  clips: scene.clips.map((c) =>
                    c.id === clip.id ? { ...c, start } : c,
                  ),
                });
              }}
            />
          </label>
          <label>
            Длина, с
            <input
              type="number"
              min=".5"
              max={scene.duration - clip.start}
              step=".5"
              value={clip.duration}
              onChange={(e) => {
                const duration = Math.max(
                  0.5,
                  Math.min(scene.duration - clip.start, Number(e.target.value)),
                );
                update({
                  clips: scene.clips.map((c) =>
                    c.id === clip.id ? { ...c, duration } : c,
                  ),
                });
              }}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              update({ clips: scene.clips.filter((c) => c.id !== clip.id) });
              setSelected(null);
            }}
          >
            Удалить
          </button>
          <button className="text-button" onClick={() => setSelected(null)}>
            Готово
          </button>
        </div>
      )}
    </section>
  );
}
