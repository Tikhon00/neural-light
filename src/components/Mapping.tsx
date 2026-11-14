import type { Scene, Layout } from "../engine/types";
import { Cable, Grid2X2, Orbit, Spline, Upload, Download } from "lucide-react";
import { Simulator } from "./Simulator";
import type { LightRuntime } from "../runtime/runtime";
import { validatePoints } from "../engine/mapping";
import { useRef } from "react";
export function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Mapping({
  scene,
  update,
  runtime,
  error,
}: {
  scene: Scene;
  update: (s: Partial<Scene>) => void;
  runtime: LightRuntime;
  error: (s: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const layouts: {
    id: Layout;
    name: string;
    description: string;
    icon: typeof Cable;
  }[] = [
    {
      id: "arch",
      name: "Световые арки",
      description: "4 арки в пространстве",
      icon: Spline,
    },
    {
      id: "strip",
      name: "Лента",
      description: "Одна непрерывная линия",
      icon: Cable,
    },
    {
      id: "matrix",
      name: "Матрица",
      description: "2D · змейка по строкам",
      icon: Grid2X2,
    },
    {
      id: "helix",
      name: "Спираль",
      description: "3D · три витка",
      icon: Orbit,
    },
  ];
  return (
    <section className="mapping-page">
      <div className="panel-heading">
        <div>
          <h2>Форма вашего света</h2>
          <span className="muted">
            Порядок точек соответствует адресам LED на контроллере.
          </span>
        </div>
        <label className="count-field">
          Количество LED
          <input
            aria-label="Количество LED"
            type="number"
            min={1}
            max={8192}
            value={scene.count}
            onChange={(e) => {
              const count = Math.round(
                Math.max(1, Math.min(8192, Number(e.target.value))),
              );
              update({ count, customPoints: undefined });
            }}
          />
        </label>
      </div>
      <div className="layout-options">
        {layouts.map(({ id, name, description, icon: Icon }) => (
          <button
            key={id}
            className={
              scene.layout === id && !scene.customPoints
                ? "layout-option selected-layout"
                : "layout-option"
            }
            onClick={() => update({ layout: id, customPoints: undefined })}
          >
            <Icon size={20} />
            <span>
              {name}
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>
      <Simulator runtime={runtime} />
      <div className="mapping-footer">
        <p>
          {scene.customPoints
            ? "Используется ваш маппинг."
            : "Координаты нормализованы. Импортируйте свой массив x, y, z для любой инсталляции."}
        </p>
        <div className="button-row">
          <button className="secondary" onClick={() => file.current?.click()}>
            <Upload size={14} /> Импорт XYZ
          </button>
          <button
            className="secondary"
            onClick={() =>
              downloadJSON(runtime.points, "neural-light-mapping.json")
            }
          >
            <Download size={14} /> Экспорт
          </button>
        </div>
      </div>
      <input
        ref={file}
        hidden
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 2_000_000) throw new Error("Файл больше 2 МБ");
            const points = JSON.parse(await f.text());
            if (!validatePoints(points, scene.count))
              throw new Error(
                `Нужно ровно ${scene.count} точек с числовыми x, y, z от −100 до 100.`,
              );
            update({ customPoints: points });
          } catch (err) {
            error((err as Error).message);
          }
          e.target.value = "";
        }}
      />
    </section>
  );
}
