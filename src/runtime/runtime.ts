import { AudioInput } from "./audio";
import { makeMapping } from "../engine/mapping";
import { renderFrame } from "../engine/effects";
import { FrameTransition } from "../engine/frame-transition";
import {
  emptyFeatures,
  type Controller,
  type Scene,
  type Telemetry,
} from "../engine/types";

export class LightRuntime {
  scene: Scene;
  points;
  frame: Uint8Array;
  audio = new AudioInput();
  native = false;
  private socket?: WebSocket;
  private raf = 0;
  private last = 0;
  private published = 0;
  private elapsed = 0;
  private ticks = 0;
  private framesSinceReport = 0;
  private costs: number[] = [];
  private listeners = new Set<() => void>();
  private reconnect?: number;
  private disposed = false;
  private authTimer?: number;
  private nativeLast = 0;
  private telemetryReceivedAt = 0;
  private readonly frameTransition = new FrameTransition();
  private pendingTransition: number | undefined;
  onError: (message: string) => void = () => {};
  onNativeChange: () => void = () => {};
  onSourceChanged: (source: Scene["source"]) => void = () => {};
  telemetry: Telemetry = {
    fps: 0,
    renderMs: 0,
    audioAgeMs: 0,
    elapsed: 0,
    frames: 0,
    dropped: 0,
    backend: "Web · CPU",
    features: emptyFeatures(),
    devices: [],
    rttMs: null,
  };
  constructor(scene: Scene) {
    this.scene = scene;
    this.points = scene.customPoints || makeMapping(scene.layout, scene.count);
    this.frame = new Uint8Array(scene.count * 3);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.telemetry;
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  start() {
    this.disposed = false;
    this.audio.onEnded = () => this.onSourceChanged("demo");
    this.connect();
    this.raf = requestAnimationFrame(this.tick);
  }
  close() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.reconnect);
    clearTimeout(this.authTimer);
    this.socket?.close();
    this.audio.close();
    this.frameTransition.cancel();
    this.pendingTransition = undefined;
  }
  /** Apply a fade only to the next explicit scene selection, never to sliders. */
  transitionScene(durationMs: number) {
    this.pendingTransition = Number.isFinite(durationMs)
      ? Math.max(0, Math.min(600, durationMs))
      : 0;
  }
  update(scene: Scene) {
    const topologyChanged =
      scene.count !== this.scene.count ||
      scene.layout !== this.scene.layout ||
      scene.customPoints !== this.scene.customPoints;
    const transitionMs = this.pendingTransition;
    this.pendingTransition = undefined;
    const fadeMs = topologyChanged || scene.brightness === 0 ? 0 : transitionMs;
    if (this.native || topologyChanged || scene.brightness === 0) {
      this.frameTransition.cancel();
    } else if (fadeMs !== undefined) {
      this.frameTransition.begin(this.frame, performance.now(), fadeMs);
    }
    if (topologyChanged) {
      this.points =
        scene.customPoints || makeMapping(scene.layout, scene.count);
      if (this.frame.length !== scene.count * 3)
        this.frame = new Uint8Array(scene.count * 3);
    }
    if (scene.brightness === 0) this.frame.fill(0);
    this.scene = scene;
    this.send({
      type: "scene",
      scene,
      ...(transitionMs !== undefined ? { transitionMs: fadeMs } : {}),
    });
  }
  async selectSource(source: Scene["source"]) {
    if (!this.native) await this.audio.select(source);
  }
  async monitor(enabled: boolean) {
    const offset = this.native
      ? this.telemetry.features.capturedAt +
        (performance.now() - this.telemetryReceivedAt) / 1000
      : 0;
    await this.audio.setMonitor(enabled, offset);
  }
  seek(time: number) {
    this.elapsed = Math.max(0, Math.min(this.scene.duration, time));
    this.send({ type: "seek", time: this.elapsed });
  }
  devices(controllers: Controller[]) {
    this.send({ type: "controllers", controllers });
  }
  ping() {
    this.send({ type: "ping", time: performance.now() });
  }
  private send(value: unknown) {
    if (this.native && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(value));
  }
  private connect() {
    const query = new URLSearchParams(location.search),
      token = query.get("token");
    if (!token || this.disposed) return;
    const port = Number(query.get("port") || 8742);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = "arraybuffer";
    this.socket = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      this.authTimer = window.setTimeout(() => {
        if (!this.native) ws.close();
      }, 3000);
    };
    ws.onmessage = (event) => {
      this.nativeLast = performance.now();
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);
        if (view.byteLength < 16 || view.getUint32(0, false) !== 0x4e4c3031)
          return;
        const count = view.getUint32(8, true);
        if (count === this.scene.count && view.byteLength === 16 + count * 3) {
          // An already queued native frame must not undo an immediate blackout.
          if (this.scene.brightness === 0) this.frame.fill(0);
          else this.frame.set(new Uint8Array(event.data, 16));
        }
        return;
      }
      try {
        const message = JSON.parse(event.data);
        if (message.type === "hello") {
          this.native = true;
          clearTimeout(this.authTimer);
          this.audio.stopCapture();
          this.update(this.scene);
          this.onNativeChange();
        }
        if (message.type === "telemetry") {
          this.telemetryReceivedAt = performance.now();
          this.telemetry = { ...this.telemetry, ...message };
          this.elapsed = message.elapsed;
          this.emit();
        }
        if (message.type === "pong") {
          this.telemetry = {
            ...this.telemetry,
            rttMs: performance.now() - message.time,
          };
          this.emit();
        }
        if (message.type === "error") {
          this.onError(message.message);
          if (message.source === "demo") this.onSourceChanged("demo");
        }
      } catch {
        this.onError("Движок прислал повреждённое сообщение");
      }
    };
    ws.onclose = () => {
      if (this.native) {
        this.native = false;
        this.scene = { ...this.scene, source: "demo" };
        this.onNativeChange();
        this.onError("Связь с движком прервана. Включён локальный деморежим.");
      }
      if (!this.disposed)
        this.reconnect = window.setTimeout(() => this.connect(), 2500);
    };
    ws.onerror = () => {}; // onclose owns retry and user feedback
  }
  private tick = (now: number) => {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    if (this.native && now - this.nativeLast > 4000) this.socket?.close();
    if (!this.native) {
      if (this.scene.playing) this.elapsed += dt;
      const start = performance.now(),
        features = this.audio.read(now / 1000);
      renderFrame(
        this.scene,
        this.points,
        features,
        this.elapsed,
        this.frame,
        this.audio.color,
      );
      this.frameTransition.apply(this.frame, now, this.scene.brightness === 0);
      this.costs.push(performance.now() - start);
      if (this.costs.length > 60) this.costs.shift();
      this.ticks++;
      this.framesSinceReport++;
      if (now - this.published >= 150) {
        const fps = this.published
          ? (this.framesSinceReport * 1000) / (now - this.published)
          : 0;
        this.telemetry = {
          ...this.telemetry,
          fps,
          renderMs: this.costs.reduce((a, b) => a + b, 0) / this.costs.length,
          elapsed: this.elapsed,
          features,
          frames: this.ticks,
          backend: "Web · CPU",
          devices: [],
          audioAgeMs: this.audio.source === "demo" ? 0 : (2048 / 48000) * 1000,
          rttMs: null,
        };
        this.framesSinceReport = 0;
        this.published = now;
        this.emit();
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
