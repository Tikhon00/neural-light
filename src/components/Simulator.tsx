import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Expand, RotateCcw, Box, Move } from "lucide-react";
import type { LightRuntime } from "../runtime/runtime";
import { RoomPreview } from "./preview/RoomPreview";

const WebGLRoom = lazy(() =>
  import("./preview/RoomSimulator").then(
    (module) => ({ default: module.RoomSimulator }),
    () => ({
      default: ({ fallback }: { fallback: React.ReactNode }) => <>{fallback}</>,
    }),
  ),
);
type SimulatorProps = {
  runtime: LightRuntime;
  immersive?: boolean;
  previewMode?: "room" | "mapping";
};
export function Simulator(props: SimulatorProps) {
  if (props.immersive && props.previewMode !== "mapping") {
    const fallback = <CanvasSimulator {...props} />;
    return (
      <Suspense fallback={fallback}>
        <WebGLRoom runtime={props.runtime} fallback={fallback} />
      </Suspense>
    );
  }
  return <CanvasSimulator {...props} />;
}

function CanvasSimulator({
  runtime,
  immersive = false,
  previewMode = "room",
}: {
  runtime: LightRuntime;
  immersive?: boolean;
  previewMode?: "room" | "mapping";
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    panel = useRef<HTMLElement>(null),
    rotation = useRef(-0.48),
    roomRotation = useRef(-0.23),
    dragging = useRef<number | null>(null);
  const room = immersive && previewMode === "room";
  const turn = (delta: number) => {
    if (room)
      roomRotation.current = Math.max(
        -0.55,
        Math.min(0.55, roomRotation.current + delta),
      );
    else rotation.current += delta;
  };
  const [flat, setFlat] = useState(false),
    [glow, setGlow] = useState(true);
  useEffect(() => {
    const canvas = ref.current!,
      context = canvas.getContext("2d")!;
    const roomPreview = room ? new RoomPreview() : null;
    let raf = 0;
    let stageTop = 0,
      stageBottom = 0,
      w = 0,
      h = 0;
    // Keep the light sculpture in the open space between the heading and dock.
    // Measuring on resize also accounts for long scene names and text scaling.
    const sceneSpace = canvas.closest(".light-space");
    const heading = sceneSpace?.querySelector(".scene-heading");
    const dock = sceneSpace?.querySelector(".light-dock");
    const caption = sceneSpace?.querySelector(".preview-caption");
    const measureStage = () => {
      const bounds = canvas.getBoundingClientRect();
      w = bounds.width;
      h = bounds.height;
      stageTop = heading
        ? heading.getBoundingClientRect().bottom - bounds.top + 28
        : bounds.height * 0.24;
      stageBottom =
        caption || dock
          ? (caption || dock)!.getBoundingClientRect().top - bounds.top - 16
          : bounds.height * 0.77;
    };
    const observer = new ResizeObserver(measureStage);
    observer.observe(canvas);
    if (immersive) {
      if (heading) observer.observe(heading);
      if (dock) observer.observe(dock);
      if (caption) observer.observe(caption);
    }
    measureStage();
    const draw = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (!w || !h) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "#080a0d";
      context.fillRect(0, 0, w, h);
      if (roomPreview) {
        roomPreview.draw(
          context,
          w,
          h,
          dpr,
          stageTop,
          stageBottom,
          roomRotation.current,
          runtime.frame,
        );
        raf = requestAnimationFrame(draw);
        return;
      }
      const angle = flat ? 0 : rotation.current,
        pitch = flat ? 0 : 0.13,
        stageHeight = Math.max(48, stageBottom - stageTop),
        scale = immersive
          ? Math.min(w * 0.38, stageHeight / 2.1)
          : Math.min(w * 0.38, h * 0.45),
        centerY = immersive
          ? (stageTop + stageBottom) * 0.5 + scale * 0.07
          : h * 0.51,
        cosAngle = Math.cos(angle),
        sinAngle = Math.sin(angle),
        cosPitch = Math.cos(pitch),
        sinPitch = Math.sin(pitch);
      const project = (
        x: number,
        y: number,
        z: number,
      ): [number, number, number] => {
        const rx = x * cosAngle + z * sinAngle,
          rz = -x * sinAngle + z * cosAngle,
          ry = y * cosPitch - rz * sinPitch,
          depth = 1 / Math.max(0.2, 1 + (rz * cosPitch + y * sinPitch) * 0.17);
        return [
          w * 0.5 + rx * scale * depth,
          centerY - ry * scale * depth,
          depth,
        ];
      };
      const points = runtime.points,
        rgb = runtime.frame,
        step = Math.max(1, Math.ceil(points.length / 900));
      // This atmospheric spill is derived from the current LED frame.
      // It never changes the pixels sent to a controller.
      if (glow && points.length) {
        let red = 0,
          green = 0,
          blue = 0,
          samples = 0;
        const sampleStep = Math.max(1, Math.ceil(points.length / 48));
        for (let i = 0; i < points.length; i += sampleStep) {
          red += rgb[i * 3] || 0;
          green += rgb[i * 3 + 1] || 0;
          blue += rgb[i * 3 + 2] || 0;
          samples++;
        }
        const color = `${Math.round(red / samples)},${Math.round(green / samples)},${Math.round(blue / samples)}`;
        context.save();
        context.translate(w * 0.5, centerY);
        context.scale(1.4, 1);
        const halo = context.createRadialGradient(0, 0, 0, 0, 0, scale * 1.65);
        halo.addColorStop(0, `rgba(${color},0.15)`);
        halo.addColorStop(0.55, `rgba(${color},0.055)`);
        halo.addColorStop(1, `rgba(${color},0)`);
        context.fillStyle = halo;
        context.fillRect(
          -scale * 1.65,
          -scale * 1.65,
          scale * 3.3,
          scale * 3.3,
        );
        context.restore();
        if (!flat) {
          const floorY = project(0, -0.72, 0)[1];
          context.save();
          context.translate(w * 0.5, floorY);
          context.scale(1, 0.18);
          const spill = context.createRadialGradient(
            0,
            0,
            0,
            0,
            0,
            scale * 1.3,
          );
          spill.addColorStop(0, `rgba(${color},0.15)`);
          spill.addColorStop(1, `rgba(${color},0)`);
          context.fillStyle = spill;
          context.fillRect(
            -scale * 1.3,
            -scale * 1.3,
            scale * 2.6,
            scale * 2.6,
          );
          context.restore();
        }
      }
      if (!flat && !immersive) {
        context.strokeStyle = "rgba(184,199,215,0.065)";
        context.lineWidth = 0.6;
        for (let i = -5; i <= 5; i++) {
          for (let axis = 0; axis < 2; axis++) {
            const a = project(axis ? i * 0.4 : -2, -0.74, axis ? -2 : i * 0.4),
              b = project(axis ? i * 0.4 : 2, -0.74, axis ? 2 : i * 0.4);
            context.beginPath();
            context.moveTo(a[0], a[1]);
            context.lineTo(b[0], b[1]);
            context.stroke();
          }
        }
      }
      // Preview subsampling affects only drawing; every output LED remains rendered.
      const projected = [];
      for (let i = 0; i < points.length; i += step) {
        const p = points[i],
          [x, y, depth] = project(p.x, p.y, p.z);
        projected.push({
          i,
          x,
          y,
          depth,
          r: rgb[i * 3] || 0,
          g: rgb[i * 3 + 1] || 0,
          b: rgb[i * 3 + 2] || 0,
        });
      }
      if (glow && !flat) {
        // A low-contrast, softened mirror anchors the sculpture to its floor.
        context.globalCompositeOperation = "screen";
        const reflectionStep = Math.max(4, Math.ceil(projected.length / 120));
        for (let j = 0; j < projected.length; j += reflectionStep) {
          const { i, r, g, b } = projected[j],
            p = points[i];
          if (p.y < -0.74) continue;
          const [x, y, depth] = project(p.x, -1.48 - p.y, p.z),
            radius = Math.max(10, scale * 0.065) * depth,
            opacity = Math.max(0, 0.15 - (p.y + 0.74) * 0.055),
            gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          context.fillStyle = gradient;
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }
      if (glow) {
        context.globalCompositeOperation = "screen";
        const bloomStep = Math.max(2, Math.ceil(projected.length / 300));
        for (let j = 0; j < projected.length; j += bloomStep) {
          const { x, y, depth, r, g, b } = projected[j],
            radius = Math.max(17, Math.min(38, scale * 0.1)) * depth,
            gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(${r},${g},${b},0.68)`);
          gradient.addColorStop(0.28, `rgba(${r},${g},${b},0.19)`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          context.fillStyle = gradient;
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }
      context.globalCompositeOperation = "lighter";
      for (const { x, y, depth, r, g, b } of projected) {
        context.beginPath();
        context.arc(x, y, Math.max(1.1, 2 * depth), 0, Math.PI * 2);
        context.fillStyle = `rgb(${r},${g},${b})`;
        context.fill();
        context.beginPath();
        context.arc(x, y, Math.max(0.4, 0.65 * depth), 0, Math.PI * 2);
        context.fillStyle = `rgba(255,255,255,${(Math.max(r, g, b) / 255) * 0.75})`;
        context.fill();
      }
      context.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [runtime, flat, glow, immersive, room]);
  return (
    <section
      className={`simulator${immersive ? " immersive-simulator" : ""}`}
      ref={panel}
      aria-label="Виртуальная LED-инсталляция"
      data-preview-renderer="canvas"
    >
      {!immersive && (
        <div className="sim-toolbar">
          <span className="subtle-label">
            <Box size={15} /> Предпросмотр
          </span>
          <div className="segmented" aria-label="Вид сцены">
            <button
              className={!flat ? "selected" : ""}
              aria-pressed={!flat}
              onClick={() => setFlat(false)}
            >
              3D
            </button>
            <button
              className={flat ? "selected" : ""}
              aria-pressed={flat}
              onClick={() => setFlat(true)}
            >
              2D
            </button>
          </div>
        </div>
      )}
      <canvas
        ref={ref}
        aria-label={
          room
            ? `Пример подсветки за монитором, ${runtime.scene.count} светодиодов. Потяните или используйте стрелки влево и вправо, чтобы повернуть. Home — исходный ракурс.`
            : `Предпросмотр ${runtime.scene.count} светодиодов. Потяните или используйте стрелки влево и вправо, чтобы повернуть сцену. Home — исходный ракурс.`
        }
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            turn(e.key === "ArrowLeft" ? -0.1 : 0.1);
          } else if (e.key === "Home") {
            e.preventDefault();
            roomRotation.current = -0.23;
            rotation.current = -0.48;
          }
        }}
        onPointerDown={(e) => {
          dragging.current = e.clientX;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current !== null) {
            turn((e.clientX - dragging.current) * (room ? 0.004 : 0.008));
            dragging.current = e.clientX;
          }
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onLostPointerCapture={() => {
          dragging.current = null;
        }}
      />
      {!immersive && (
        <>
          <div className="sim-bottom">
            <span>
              <Move size={13} /> Потяните, чтобы повернуть
            </span>
            <div className="sim-actions">
              <button
                className={glow ? "active-text" : ""}
                aria-pressed={glow}
                onClick={() => setGlow(!glow)}
              >
                Свечение
              </button>
              <button
                className="icon-button"
                aria-label="Сбросить ракурс"
                onClick={() => {
                  rotation.current = -0.48;
                  setFlat(false);
                }}
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Полный экран"
                onClick={() => {
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void panel.current
                      ?.requestFullscreen()
                      .catch(() =>
                        runtime.onError("Полный экран недоступен в этом окне."),
                      );
                }}
              >
                <Expand size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
