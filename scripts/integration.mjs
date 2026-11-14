import { spawn } from "node:child_process";
import dgram from "node:dgram";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

const token = "local-integration-test-only",
  port = 18742;
const process = spawn(
  "native/.build/release/neural-light-engine",
  ["--port", String(port), "--token", token],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let stderr = "";
process.stderr.on("data", (data) => {
  stderr += data;
});
const ddp = dgram.createSocket("udp4"),
  dnrgb = dgram.createSocket("udp4");
let ws, unauthorized;
const until = async (predicate, timeout = 5000) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout)
      throw new Error(`Timed out. Engine: ${stderr}`);
    await delay(20);
  }
};
try {
  await Promise.all([
    new Promise((r) => ddp.bind(4048, "127.0.0.1", r)),
    new Promise((r) => dnrgb.bind(21324, "127.0.0.1", r)),
  ]);
  await delay(400);
  unauthorized = new WebSocket(`ws://127.0.0.1:${port}`);
  let rejected = false;
  unauthorized.onopen = () =>
    unauthorized.send(JSON.stringify({ type: "auth", token: "wrong" }));
  unauthorized.onclose = () => {
    rejected = true;
  };
  await until(() => rejected);
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = "arraybuffer";
  let authenticated = false,
    frames = 0,
    lastPixels = 0;
  const telemetry = [],
    errors = [],
    packets = [],
    legacy = [];
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      const m = JSON.parse(e.data);
      if (m.type === "hello") authenticated = true;
      if (m.type === "telemetry") telemetry.push(m);
      if (m.type === "error") errors.push(m.message);
    } else {
      const data = Buffer.from(e.data);
      assert.equal(data.toString("utf8", 0, 4), "NL01");
      lastPixels = data.readUInt32LE(8);
      assert.equal(data.length, 16 + lastPixels * 3);
      frames++;
    }
  };
  ddp.on("message", (data) => packets.push({ data, time: performance.now() }));
  dnrgb.on("message", (data) => legacy.push(data));
  await until(() => authenticated && frames > 5);
  const scene = JSON.parse(await readFile("examples/aurora.json", "utf8"));
  scene.count = 1000;
  ws.send(JSON.stringify({ type: "scene", scene }));
  await until(() => lastPixels === 1000);
  const common = {
    enabled: true,
    host: "127.0.0.1",
    offset: 0,
    latencyMs: 0,
    budgetKbps: 160,
  };
  ws.send(
    JSON.stringify({
      type: "controllers",
      controllers: [
        {
          ...common,
          id: "test-ddp",
          name: "Loopback DDP",
          count: 1000,
          protocol: "ddp",
        },
        {
          ...common,
          id: "test-dnrgb",
          name: "Loopback DNRGB",
          count: 17,
          protocol: "dnrgb",
          latencyMs: 20,
        },
      ],
    }),
  );
  await until(() => packets.length >= 9 && legacy.length > 3);
  const first = packets.slice(0, 3).map((p) => p.data);
  assert.deepEqual(
    first.map((p) => p[0]),
    [0x40, 0x40, 0x41],
  );
  assert.deepEqual(
    first.map((p) => p.readUInt32BE(4)),
    [0, 1440, 2880],
  );
  assert.equal(
    first.reduce((n, p) => n + p.length - 10, 0),
    3000,
  );
  assert.deepEqual([...legacy[0].subarray(0, 4)], [4, 2, 0, 0]);
  assert.equal(legacy[0].length, 55);
  ws.send(
    JSON.stringify({ type: "scene", scene: { ...scene, brightness: -1 } }),
  );
  await until(() => errors.length === 1);
  const stats = telemetry.at(-1).devices.find((d) => d.id === "test-ddp");
  assert(stats.fps < 7);
  assert(stats.dropped > 0);
  ws.send(JSON.stringify({ type: "controllers", controllers: [] }));
  const results = [];
  for (const count of [240, 1000, 4096, 8192]) {
    scene.count = count;
    ws.send(JSON.stringify({ type: "scene", scene }));
    await delay(700);
    const start = telemetry.length;
    await delay(3000);
    const samples = telemetry.slice(start),
      times = samples.map((m) => m.renderMs).sort((a, b) => a - b);
    assert(samples.length > 15);
    assert(samples.every((m) => m.backend.startsWith("Metal")));
    results.push({
      leds: count,
      samples: times.length,
      meanFPS: samples.reduce((sum, m) => sum + m.fps, 0) / samples.length,
      renderP50Ms: times[Math.floor(times.length * 0.5)],
      renderP95Ms: times[Math.floor(times.length * 0.95)],
      dropped: samples.at(-1).dropped,
    });
  }
  const report = {
    backend: telemetry.at(-1).backend,
    checks: [
      "unauthorized client rejected",
      "authenticated WebSocket RGB preview",
      "1000 LED DDP fragmentation over UDP loopback",
      "DNRGB loopback",
      "invalid scene rejected",
      "bandwidth cap and dropped-frame telemetry",
    ],
    results,
    note: "Metal compute submission-to-completion; no physical ESP32/LEDs connected. FPS is native render cadence, not preview paint rate.",
  };
  await writeFile(
    "artifacts/native-integration.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws?.close();
  unauthorized?.close();
  ddp.close();
  dnrgb.close();
  process.kill("SIGTERM");
}
