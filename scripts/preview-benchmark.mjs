import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// This measures visible browser frame cadence, not GPU time or LED latency.
// Run against `npm run dev` without a simultaneous test/build workload.
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const results = [];
try {
  await page.goto("http://127.0.0.1:5173");
  await page.locator('[data-preview-renderer="webgl"]').waitFor();
  const graphics = await page
    .locator('[data-preview-renderer="webgl"] canvas')
    .evaluate((canvas) => {
      const gl = canvas.getContext("webgl2");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "WebGL2";
    });
  for (const count of [240, 8192]) {
    if (count !== 240) {
      await page.getByRole("button", { name: "Ещё", exact: true }).click();
      await page
        .getByRole("button", { name: "Расположение LED", exact: true })
        .click();
      await page
        .getByRole("spinbutton", { name: "Количество LED", exact: true })
        .fill(String(count));
      await page
        .getByRole("button", { name: "Закрыть панель", exact: true })
        .click();
    }
    for (const glass of [false, true]) {
      if (glass)
        await page
          .getByRole("button", { name: "Настроить свет", exact: true })
          .click();
      await page.waitForTimeout(800);
      const timing = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const intervals = [];
            let previous;
            const sample = (time) => {
              if (previous !== undefined) intervals.push(time - previous);
              previous = time;
              if (intervals.length < 180) requestAnimationFrame(sample);
              else {
                const sorted = [...intervals].sort((a, b) => a - b);
                resolve({
                  frames: intervals.length,
                  fps:
                    (1000 * intervals.length) /
                    intervals.reduce((a, b) => a + b, 0),
                  p50Ms: sorted[Math.floor(sorted.length * 0.5)],
                  p95Ms: sorted[Math.floor(sorted.length * 0.95)],
                  framesOver25Ms: intervals.filter((ms) => ms > 25).length,
                });
              }
            };
            requestAnimationFrame(sample);
          }),
      );
      results.push({ count, glass, ...timing });
      if (glass)
        await page
          .getByRole("button", { name: "Закрыть панель", exact: true })
          .click();
    }
  }
  const report = {
    date: new Date().toISOString(),
    renderer: "webgl",
    graphics,
    viewport: "1440×900",
    browser: await browser.version(),
    results,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/preview-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
