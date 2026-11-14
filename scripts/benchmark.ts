import { performance } from "node:perf_hooks";
import os from "node:os";
import { AudioAnalyzer, demoPCM } from "../src/engine/dsp";
import { makeMapping } from "../src/engine/mapping";
import { renderFrame } from "../src/engine/effects";
import { defaultScene } from "../src/engine/types";
const analyzer = new AudioAnalyzer(),
  pcm = new Float32Array(2048),
  results = [];
for (const count of [240, 1000, 4096, 8192]) {
  const scene = { ...defaultScene, count },
    points = makeMapping("arch", count),
    rgb = new Uint8Array(count * 3),
    times = [];
  for (let i = 0; i < 360; i++) {
    demoPCM(pcm, i / 60);
    const start = performance.now();
    const features = analyzer.analyze(pcm, 48000, i / 60);
    renderFrame(scene, points, features, i / 60, rgb);
    if (i >= 60) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({
    leds: count,
    samples: times.length,
    p50Ms: times[150],
    p95Ms: times[285],
    p99Ms: times[297],
    within60FPSBudget: times[297] < 16.667,
  });
}
console.log(
  JSON.stringify(
    {
      platform: `${os.platform()} ${os.arch()}`,
      cpu: os.cpus()[0].model,
      runtime: process.version,
      backend:
        "TypeScript FFT + CPU effects; excludes browser painting and network",
      results,
    },
    null,
    2,
  ),
);
