import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Exercise the page that is actually compiled into the ESP32 firmware.
const headerPath = fileURLToPath(new URL("../../firmware/include/SetupPage.h", import.meta.url));
const source = readFileSync(headerPath, "utf8");
const setupHtml = source.match(/R"NLHTML\(([\s\S]*?)\)NLHTML";/)?.[1];
if (!setupHtml) throw new Error("Embedded ESP32 setup page could not be extracted");

const defaultConfig = {
  configured: false,
  ssid: "",
  pin: 16,
  count: 240,
  order: "GRB",
  limit: 25,
  openNetwork: false,
  token: "local-ui-test-token-not-a-device-secret",
};
const defaultStatus = {
  connected: false,
  connecting: false,
  outputEnabled: false,
  version: "0.1.0-test",
  ip: "192.168.4.1",
  received: 0,
  displayed: 0,
  dropped: 0,
  malformed: 0,
  fps: 0,
  error: "",
};

interface Submission {
  token: string | undefined;
  contentType: string | undefined;
  fields: URLSearchParams;
}

async function board(page: Page, options: {
  config?: Partial<typeof defaultConfig>;
  status?: () => typeof defaultStatus;
  saveError?: string;
  configError?: boolean;
} = {}): Promise<Submission[]> {
  const submissions: Submission[] = [];
  await page.route("**/board-preview", (route) => route.fulfill({ contentType: "text/html", body: setupHtml }));
  await page.route("**/api/status", (route) => route.fulfill({ json: options.status?.() ?? defaultStatus }));
  await page.route("**/api/config", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill(options.configError
        ? { status: 503, json: { error: "Unavailable" } }
        : { json: { ...defaultConfig, ...options.config } });
      return;
    }
    const request = route.request();
    const headers = request.headers();
    submissions.push({
      token: headers["x-neural-token"],
      contentType: headers["content-type"],
      fields: new URLSearchParams(request.postData() ?? ""),
    });
    await route.fulfill(options.saveError
      ? { status: 400, json: { error: options.saveError } }
      : { json: { ok: true } });
  });
  return submissions;
}

test("board setup requires wiring consent before enabling a configured output", async ({ page }) => {
  const submissions = await board(page);
  await page.goto("/board-preview");
  const save = page.getByRole("button", { name: "Сохранить и подключить" });
  await expect(save).toBeEnabled();
  await expect(page.locator("#connection")).toHaveText("Сеть настройки · выбери домашний Wi-Fi");
  expect(submissions).toHaveLength(0);
  await page.getByLabel("Название сети").fill("Studio 2.4");
  await page.getByLabel("Пароль сети").fill("test-password-only");
  await save.click();
  const consent = page.getByRole("checkbox", { name: /Я проверил GPIO/ });
  await expect(consent).not.toBeChecked();
  expect(await consent.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  expect(submissions).toHaveLength(0);

  await consent.check();
  await save.click();
  await expect(page.locator("#message")).toContainText("Настройки приняты");
  expect(submissions).toHaveLength(1);
  expect(submissions[0].token).toBe(defaultConfig.token);
  expect(submissions[0].contentType).toContain("application/x-www-form-urlencoded");
  expect(Object.fromEntries(submissions[0].fields)).toEqual({
    ssid: "Studio 2.4",
    password: "test-password-only",
    pin: "16",
    count: "240",
    order: "GRB",
    limit: "25",
    confirmWiring: "1",
  });
  await expect(page.getByLabel("Пароль сети")).toHaveValue("");
  // Accepting settings is not rendered as a successful Wi-Fi or LED connection.
  await expect(page.locator("#connection")).not.toContainText("Готов принимать");
});

test("board status shows connection progress and the actual station address", async ({ page }) => {
  let polls = 0;
  await board(page, { status: () => ++polls === 1
    ? { ...defaultStatus, connecting: true }
    : { ...defaultStatus, connected: true, outputEnabled: true, ip: "192.168.1.77", received: 64, displayed: 60, dropped: 4, fps: 59.5 } });
  await page.goto("/board-preview");
  await expect(page.locator("#connection")).toHaveText("Подключаюсь к твоему Wi-Fi…");
  await expect(page.locator("#connectedHint")).toBeHidden();
  await expect(page.locator("#connection")).toHaveText("Готов принимать свет с Mac", { timeout: 6000 });
  await expect(page.locator("#connectedHint")).toContainText("192.168.1.77");
  await page.getByText("Состояние контроллера", { exact: true }).click();
  await expect(page.locator("#ip")).toHaveText("192.168.1.77");
  await expect(page.locator("#displayed")).toHaveText("60");
  await expect(page.locator("#dropped")).toHaveText("4");
});

test("an existing Wi-Fi password stays empty and can be retained", async ({ page }) => {
  const submissions = await board(page, { config: { configured: true, ssid: "Existing network" } });
  await page.goto("/board-preview");
  await expect(page.getByLabel("Название сети")).toHaveValue("Existing network");
  await expect(page.getByLabel("Пароль сети")).toHaveValue("");
  await expect(page.locator("#passwordHint")).toHaveText("Оставь пустым, чтобы сохранить текущий пароль.");
  await page.getByLabel("Число светодиодов").fill("300");
  await page.getByRole("checkbox", { name: /Я проверил GPIO/ }).check();
  await page.getByRole("button", { name: "Сохранить и подключить" }).click();
  await expect(page.locator("#message")).toContainText("Настройки приняты");
  expect(submissions).toHaveLength(1);
  expect(submissions[0].fields.get("password")).toBe("");
  expect(submissions[0].fields.get("count")).toBe("300");
});

test("changing the Wi-Fi name requires a new password", async ({ page }) => {
  const submissions = await board(page, { config: { configured: true, ssid: "Existing network" } });
  await page.goto("/board-preview");
  await expect(page.getByLabel("Название сети")).toHaveValue("Existing network");
  await page.getByLabel("Название сети").fill("Different network");
  await page.getByRole("checkbox", { name: /Я проверил GPIO/ }).check();
  await page.getByRole("button", { name: "Сохранить и подключить" }).click();
  await expect(page.locator("#message")).toHaveText("Укажи пароль Wi-Fi: минимум 8 символов.");
  expect(submissions).toHaveLength(0);
});

test("board API errors stay visible and saving can be retried", async ({ page }) => {
  const submissions = await board(page, {
    config: { configured: true, ssid: "Existing network" },
    saveError: "Этот GPIO недоступен. Выбери другой.",
  });
  await page.goto("/board-preview");
  const save = page.getByRole("button", { name: "Сохранить и подключить" });
  await expect(save).toBeEnabled();
  await page.getByRole("checkbox", { name: /Я проверил GPIO/ }).check();
  await save.click();
  await expect(page.locator("#message")).toHaveText("Этот GPIO недоступен. Выбери другой.");
  await expect(save).toBeEnabled();
  expect(submissions).toHaveLength(1);
});

test("board configuration failure does not enable saving", async ({ page }) => {
  const submissions = await board(page, { configError: true });
  await page.goto("/board-preview");
  await expect(page.locator("#message")).toHaveText("Не удалось загрузить настройки. Обнови страницу.");
  await expect(page.getByRole("button", { name: "Сохранить и подключить" })).toBeDisabled();
  expect(submissions).toHaveLength(0);
});

for (const width of [390, 1440]) {
  test(`actual board setup page is accessible at ${width}px`, async ({ page }) => {
    await board(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/board-preview");
    await expect(page.getByRole("button", { name: "Сохранить и подключить" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/board-setup-${width}.png`, fullPage: true });
  });
}
