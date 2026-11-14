import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const manifest = {
  name: "NEURAL LIGHT NODE",
  version: "0.1.0-test",
  new_install_improv_wait_time: 0,
  builds: [{ chipFamily: "ESP32", parts: [{ path: "neural-light-node.bin", offset: 0 }] }],
};

async function files(page: Page): Promise<void> {
  await page.route("**/firmware/manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/firmware/neural-light-node.bin", (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "application/octet-stream", "content-length": "1024" },
    body: Buffer.alloc(1024),
  }));
}

test("requires explicit overwrite consent and never opens USB on page load", async ({ page }) => {
  await files(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", { value: {
      requestPort: () => { throw new Error("USB must not open without explicit user action"); },
      getPorts: async () => [],
    } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Версия 0.1.0-test · файлы готовы");
  const connect = page.getByRole("button", { name: "Подключить ESP32" });
  await expect(connect).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(connect).toBeEnabled();
  await page.getByRole("checkbox").uncheck();
  await expect(connect).toBeDisabled();
  expect(errors).toEqual([]);
});

test("missing manifest can recover without pretending to be connected", async ({ page }) => {
  await page.route("**/firmware/manifest.json", (route) => route.fulfill({ status: 404, body: "Missing" }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Не удалось загрузить прошивку");
  await expect(page.getByRole("checkbox")).toBeHidden();
  await expect(page.getByRole("button", { name: "Подключить ESP32" })).toBeHidden();
  await files(page);
  await page.getByRole("button", { name: "Проверить ещё раз" }).click();
  await expect(page.getByRole("status")).toHaveText("Версия 0.1.0-test · файлы готовы");
});

test("does not enable flashing if a firmware binary is missing", async ({ page }) => {
  await files(page);
  await page.route("**/firmware/neural-light-node.bin", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Установка пока недоступна");
  await expect(page.getByRole("checkbox")).toBeHidden();
});

test("rejects an unexpected chip family or remote firmware source", async ({ page }) => {
  await page.route("**/firmware/manifest.json", (route) => route.fulfill({ json: {
    ...manifest,
    builds: [{ chipFamily: "ESP32-S3", parts: [{ path: "https://example.com/firmware.bin", offset: 0 }] }],
  } }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Установка пока недоступна");
  await expect(page.getByRole("checkbox")).toBeHidden();
});

test("unsupported browser explains how to continue instead of offering USB", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "serial", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Chrome или Edge на компьютере");
  await expect(page.getByRole("link", { name: "Скачать Chrome" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeHidden();
});

test("rejects a merged firmware image with a nonzero flash offset", async ({ page }) => {
  await page.route("**/firmware/manifest.json", (route) => route.fulfill({ json: {
    ...manifest,
    builds: [{ chipFamily: "ESP32", parts: [{ path: "neural-light-node.bin", offset: 4096 }] }],
  } }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Установка пока недоступна");
  await expect(page.getByRole("checkbox")).toBeHidden();
});

test("keyboard consent, instructions and accessibility", async ({ page }) => {
  await files(page);
  await page.goto("/");
  await expect(page.getByRole("checkbox")).toBeVisible();
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Подключить ESP32" })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Подключить ESP32" })).toBeFocused();
  await page.getByText("Подойдёт ли моя плата и лента?", { exact: true }).click();
  await expect(page.getByText("Эта версия — для ESP32 DevKit / WROOM", { exact: false })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits ${width}px without horizontal scrolling`, async ({ page }) => {
    await files(page);
    await page.setViewportSize({ width, height: width < 500 ? 900 : 1000 });
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("файлы готовы");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/installer-${width}.png`, fullPage: true });
  });
}
