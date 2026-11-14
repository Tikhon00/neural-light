import { AudioLines, ChevronDown, Volume2, VolumeX } from "lucide-react";
import type { Scene, Source } from "../engine/types";

export function SourcePanel({
  scene,
  source,
  busy,
  monitor,
  monitorPending,
  toggleMonitor,
}: {
  scene: Scene;
  source: (source: Source) => void;
  busy: boolean;
  monitor: boolean;
  monitorPending: boolean;
  toggleMonitor: () => void;
}) {
  return (
    <section className="source-panel" aria-label="Источник для света">
      <label className="source-panel-label" htmlFor="light-source">
        Свет реагирует на
      </label>
      <div className="source-select">
        <AudioLines size={18} aria-hidden="true" />
        <select
          id="light-source"
          aria-label="Источник звука"
          aria-describedby="source-explanation"
          value={scene.source}
          disabled={busy}
          onChange={(event) => source(event.target.value as Source)}
        >
          <option value="demo">Деморитм</option>
          <option value="microphone">Микрофон</option>
          <option value="screen">Экран и его звук</option>
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      <p id="source-explanation" className="source-panel-explanation">
        {scene.source === "demo"
          ? "Встроенный ритм оживляет свет. Его можно слушать или оставить без звука."
          : scene.source === "microphone"
            ? "Свет реагирует на музыку и звуки рядом с микрофоном."
            : "Свет получает цвет и доступный звук выбранного экрана или окна."}
      </p>
      {scene.source === "demo" && (
        <div className="source-panel-listen">
          <button
            className="secondary"
            aria-pressed={monitor}
            disabled={busy || monitorPending}
            onClick={toggleMonitor}
          >
            {monitor ? (
              <VolumeX size={18} aria-hidden="true" />
            ) : (
              <Volume2 size={18} aria-hidden="true" />
            )}
            {monitorPending
              ? "Подключаем звук…"
              : monitor
                ? "Выключить звук"
                : "Послушать"}
          </button>
          <span>{monitor ? "Звук включён" : "Сейчас без звука"}</span>
        </div>
      )}
      {busy ? (
        <p className="source-panel-status" role="status">
          Ожидаем разрешение…
        </p>
      ) : (
        scene.source === "demo" && (
          <p className="source-panel-permission">
            Для микрофона или экрана приложение попросит разрешение.
          </p>
        )
      )}
    </section>
  );
}
