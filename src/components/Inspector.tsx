import { Sun, Gauge } from "lucide-react";
import { palettes } from "../engine/effects";
import type { Scene } from "../engine/types";

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  icon,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: string;
  onChange: (v: number) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="slider-control">
      <span>
        <span>
          {icon}
          {label}
        </span>
        <output aria-live="off">{format}</output>
      </span>
      <input
        aria-label={label}
        aria-valuetext={format}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Inspector({
  scene,
  update,
}: {
  scene: Scene;
  update: (s: Partial<Scene>) => void;
}) {
  return (
    <div className="inspector" aria-label="Параметры света">
      <section className="inspector-section">
        <h3>Цвет</h3>
        <div
          className="palette-options"
          role="group"
          aria-label="Цветовая палитра"
        >
          {palettes.map((p, i) => (
            <button
              key={p.name}
              className="palette-choice"
              aria-pressed={scene.palette === i}
              onClick={() => update({ palette: i })}
            >
              <span className="palette-preview" aria-hidden="true">
                {p.colors.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="inspector-section">
        <h3>Свет</h3>
        <Slider
          icon={<Sun size={16} />}
          label="Яркость"
          value={scene.brightness}
          min={0}
          max={1}
          format={`${Math.round(scene.brightness * 100)}%`}
          onChange={(brightness) => update({ brightness })}
        />
        <Slider
          icon={<Gauge size={16} />}
          label="Скорость"
          value={scene.speed}
          min={0.05}
          max={3}
          format={`${scene.speed.toFixed(1)}×`}
          onChange={(speed) => update({ speed })}
        />
      </section>
      <details className="fine-settings">
        <summary>Тонкая настройка</summary>
        <Slider
          label="Чувствительность к звуку"
          value={scene.sensitivity}
          min={0}
          max={3}
          format={
            scene.sensitivity === 0
              ? "Выкл."
              : `${scene.sensitivity.toFixed(1)}×`
          }
          onChange={(sensitivity) => update({ sensitivity })}
        />
        <Slider
          label="Масштаб волн"
          value={scene.spread}
          min={0}
          max={1}
          format={`${Math.round(scene.spread * 100)}%`}
          onChange={(spread) => update({ spread })}
        />
      </details>
    </div>
  );
}
