import { useEffect, useRef } from "react";
import { AudioLines, Volume2, VolumeX } from "lucide-react";
import type { LightRuntime } from "../runtime/runtime";
import type { Telemetry } from "../engine/types";
export function Spectrum({
  runtime,
  telemetry,
  monitor,
  onMonitor,
}: {
  runtime: LightRuntime;
  telemetry: Telemetry;
  monitor: boolean;
  onMonitor: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext("2d")!;
    let raf = 0;
    let smooth = Array(48).fill(0);
    const draw = () => {
      const w = canvas.clientWidth,
        h = canvas.clientHeight,
        dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bands = runtime.telemetry.features.bands;
      for (let i = 0; i < 48; i++) {
        smooth[i] += ((bands[i] || 0) - smooth[i]) * 0.22;
        const bh = Math.max(2, Math.min(h, smooth[i] * h * 1.4));
        ctx.fillStyle = "#7cbaa7";
        ctx.fillRect((i * w) / 48 + 1, h - bh, Math.max(1, w / 48 - 4), bh);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  const sourceName =
    runtime.scene.source === "demo"
      ? "Демо · 120 BPM"
      : runtime.scene.source === "microphone"
        ? "Микрофон"
        : "Звук экрана";
  return (
    <section className="audio-panel" aria-label="Анализ звука">
      <div className="audio-description">
        <span className="subtle-label">
          <AudioLines size={15} /> Аудиосигнал
        </span>
        <strong>{sourceName}</strong>
        <span className="muted">FFT · 2 048 отсчётов</span>
      </div>
      <div className="spectrum-chart">
        <canvas ref={ref} aria-label="Частотный спектр от 30 Гц до 16 кГц" />
        <div className="axis">
          <span>30 Гц</span>
          <span>250</span>
          <span>1k</span>
          <span>4k</span>
          <span>16k</span>
        </div>
      </div>
      <div className="beat-readout">
        <div
          className="beat-dot"
          style={{ opacity: 0.25 + telemetry.features.beat * 0.75 }}
        />
        <strong>
          {telemetry.features.bpm || "—"} <small>BPM</small>
        </strong>
        <span>Определённый ритм</span>
      </div>
      {runtime.scene.source === "demo" && (
        <button
          className="icon-button monitor"
          aria-label={monitor ? "Выключить демозвук" : "Послушать демозвук"}
          title={monitor ? "Выключить демозвук" : "Послушать демозвук"}
          aria-pressed={monitor}
          onClick={onMonitor}
        >
          {monitor ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>
      )}
    </section>
  );
}
