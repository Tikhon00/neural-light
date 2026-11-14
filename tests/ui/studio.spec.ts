import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function settleMotion(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) => !animation.pending && animation.playState !== "running",
      ),
  );
}
async function readyPreview(page: Page) {
  await expect(page.locator(".scene-heading h1")).toBeVisible();
  await expect(page.locator('[data-preview-renderer="webgl"]')).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function openTool(page: Page, name: string) {
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function closePanel(page: Page) {
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
async function savedScene(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("neural-light.scene.v1")!),
  );
}
async function expectNoOverflow(page: Page) {
  await settleMotion(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const activeDialog = page.getByRole("dialog");
  if (await activeDialog.isVisible()) {
    const bounds = await activeDialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    const content = activeDialog.locator(".sheet-content");
    if (await content.count()) {
      expect(
        await content.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
    }
  }
}

test("home shows light and simple controls, with advanced tools out of the way", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Северное сияние", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Быстрые сцены" }).getByRole("button"),
  ).toHaveCount(6);
  await expect(page.getByRole("slider")).toHaveCount(1);
  await expect(
    page.locator(".inspector, .timeline, .diagnostic-values, .audio-panel"),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(/FPS/)).not.toBeVisible();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect.poll(async () => (await savedScene(page)).playing).toBe(false);
  await page
    .getByRole("button", { name: "Воспроизвести", exact: true })
    .click();
  await expect.poll(async () => (await savedScene(page)).playing).toBe(true);
});

test("a new user can choose, adjust, save and reopen a scene", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Глубокий океан", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Глубокий океан", exact: true }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "Яркость", exact: true }).fill("0.35");
  await openTool(page, "Сохранить сцену");
  const saveDialog = page.getByRole("dialog", {
    name: "Сохранить сцену",
    exact: true,
  });
  await saveDialog
    .getByRole("textbox", { name: "Название сцены" })
    .fill("Мой океан");
  await saveDialog
    .getByRole("button", { name: "Сохранить сцену", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("Сцена сохранена");
  await page.getByRole("button", { name: "Живой огонь", exact: true }).click();
  await page.getByRole("slider", { name: "Яркость", exact: true }).fill("0.7");
  await page
    .getByRole("button", { name: "Библиотека сцен", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть сцену Мой океан", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мой океан", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Яркость", exact: true }),
  ).toHaveValue("0.35");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мой океан", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Яркость", exact: true }),
  ).toHaveValue("0.35");
  expect(errors).toEqual([]);
});

test("settings persist palette and motion while details stay collapsed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настроить свет", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Настроить свет",
    exact: true,
  });
  await settings
    .getByRole("button", { name: "Тёплый закат", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "Тёплый закат", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await settings
    .getByRole("slider", { name: "Скорость", exact: true })
    .fill("0.45");
  await expect(
    settings.getByRole("slider", { name: "Масштаб волн", exact: true }),
  ).not.toBeVisible();
  await settings.getByText("Тонкая настройка", { exact: true }).click();
  await settings
    .getByRole("slider", { name: "Масштаб волн", exact: true })
    .fill("0.25");
  await closePanel(page);
  await page.reload();
  await expect
    .poll(async () => {
      const s = await savedScene(page);
      return [s.palette, s.speed, s.spread];
    })
    .toEqual([1, 0.45, 0.25]);
});

test("Escape closes a sheet and returns keyboard focus to its opener", async ({
  page,
}) => {
  await page.goto("/");
  const settingsButton = page.getByRole("button", {
    name: "Настроить свет",
    exact: true,
  });
  await settingsButton.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Настроить свет", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("dialog[open]"),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(settingsButton).toBeFocused();
  await settingsButton.press("Tab");
  await expect(
    page.getByRole("button", { name: "Ещё", exact: true }),
  ).toBeFocused();
});

test("rapid opening, repeated Escape and reopening leave no trapped focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const opener = page.getByRole("button", {
    name: "Настроить свет",
    exact: true,
  });
  const sheet = page.locator(".panel-dialog");
  await opener.focus();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveAttribute("open", "");
    // Interrupt entrance, then press Escape again while the exit is running.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    await expect(opener).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await settleMotion(page);
  await expect(sheet).toHaveAttribute("data-motion", "open");
  await closePanel(page);
  expect(errors).toEqual([]);
});

test("saving from tools keeps text focus after the outgoing sheet closes", async ({
  page,
}) => {
  await page.goto("/");
  await openTool(page, "Сохранить сцену");
  const input = page.getByRole("textbox", {
    name: "Название сцены",
    exact: true,
  });
  await expect(page.locator(".panel-dialog")).not.toBeVisible();
  await settleMotion(page);
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Плавный свет");
  await expect(input).toHaveValue("Плавный свет");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ещё", exact: true }),
  ).toBeFocused();
});

test("reduced motion opens and closes sheets without running animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opener = page.getByRole("button", {
    name: "Настроить свет",
    exact: true,
  });
  await opener.click();
  const sheet = page.locator(".panel-dialog");
  await expect(sheet).toBeVisible();
  expect(
    await sheet.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((a) => a.playState === "running").length,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  expect(
    await sheet.evaluate((element: HTMLDialogElement) => element.open),
  ).toBe(false);
  await expect(opener).toBeFocused();
  await openTool(page, "Устройства");
  await expect(
    page.getByRole("button", { name: "Назад к инструментам", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Назад к инструментам", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Закрыть панель", exact: true }),
  ).toBeFocused();
  await closePanel(page);
});

test("rapid scene selections settle on the last choice with one accessible title", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of [
    "Глубокий океан",
    "Живой огонь",
    "В ритме",
    "Северное сияние",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await settleMotion(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Северное сияние",
  );
  await expect(
    page
      .getByRole("group", { name: "Быстрые сцены" })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Северное сияние", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await savedScene(page)).effect).toBe("aurora");
});

test("mapping, graph and timeline remain editable through tools", async ({
  page,
}) => {
  await page.goto("/");
  await openTool(page, "Расположение LED");
  await page
    .getByRole("button", { name: "Спираль 3D · три витка", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Количество LED", exact: true })
    .fill("1000");
  await expect.poll(async () => (await savedScene(page)).count).toBe(1000);
  await expect.poll(async () => (await savedScene(page)).layout).toBe("helix");
  await closePanel(page);
  await openTool(page, "Редактор узлов");
  await page
    .getByRole("combobox", { name: "Эффект узла", exact: true })
    .selectOption("ember");
  await expect
    .poll(async () => (await savedScene(page)).layers[0].effect)
    .toBe("ember");
  await page
    .getByRole("button", { name: "Назад к инструментам", exact: true })
    .click();
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await page.getByRole("checkbox", { name: "Автосмена", exact: true }).check();
  await page.getByRole("button", { name: "Фрагмент", exact: true }).click();
  await expect.poll(async () => (await savedScene(page)).clips.length).toBe(4);
  await expect
    .poll(async () => (await savedScene(page)).timelineEnabled)
    .toBe(true);
});

test("simulator never pretends to enable a real controller", async ({
  page,
}) => {
  await page.goto("/");
  await openTool(page, "Устройства");
  await page
    .getByRole("button", { name: "Добавить контроллер", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "IP-адрес или .local", exact: true })
    .fill("192.168.1.50");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Передавать свет", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Доставка и задержка LED ещё не измерены"),
  ).toBeVisible();
});

test("a room preview changes only the view and keeps the installation intact", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "За монитором", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = await savedScene(page);
  await page.getByRole("button", { name: "Схема ленты", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Схема ленты", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const after = await savedScene(page);
  expect([after.layout, after.count, after.customPoints, after.layers]).toEqual(
    [before.layout, before.count, before.customPoints, before.layers],
  );
  await page.getByRole("button", { name: "За монитором", exact: true }).click();
  await page
    .getByRole("button", { name: "Подключить свою", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Устройства", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Пока без устройств", { exact: true }),
  ).toBeVisible();
});

test("3D preview falls back gracefully after graphics context loss", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const room = page.locator('[data-preview-renderer="webgl"]');
  await expect(room).toBeVisible();
  const canvas = room.locator("canvas");
  await canvas.focus();
  await canvas.press("ArrowLeft");
  await canvas.press("Home");
  const canLose = await canvas.evaluate((element: HTMLCanvasElement) => {
    const extension = element
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context");
    extension?.loseContext();
    return !!extension;
  });
  expect(canLose).toBe(true);
  await expect(page.locator('[data-preview-renderer="canvas"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Глубокий океан", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Глубокий океан",
  );
  await page.getByRole("slider", { name: "Яркость", exact: true }).fill("0");
  await expect(
    page.getByText("Яркость 0% · свет выключен", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("sound controls explain silent demo and are directly reachable on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".source-button")).toHaveText("Деморитм");
  await page
    .getByRole("button", { name: "Выбрать источник звука", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Звук и экран", exact: true });
  await expect(
    sheet.getByText("Сейчас без звука", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("combobox", { name: "Источник звука", exact: true }),
  ).toHaveValue("demo");
  await sheet.getByRole("button", { name: "Послушать", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Выключить звук", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await sheet
    .getByRole("button", { name: "Выключить звук", exact: true })
    .click();
  await expect(
    sheet.getByText("Сейчас без звука", { exact: true }),
  ).toBeVisible();
  await settleMotion(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({ path: "artifacts/sound-mobile.png", fullPage: true });
});

test("a saved scene can be removed and restored while the library is open", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Библиотека сцен", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить текущий свет", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Название сцены", exact: true })
    .fill("Вечер дома");
  await page
    .getByRole("button", { name: "Сохранить сцену", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Библиотека сцен", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить сцену Вечер дома", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть сцену Вечер дома", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Открыть сцену Вечер дома", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Библиотека сцен", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть сцену Вечер дома", exact: true }),
  ).toBeVisible();
});

test("home, settings and library pass accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await readyPreview(page);
  const audit = async () => {
    await settleMotion(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  };
  await audit();
  await page.screenshot({
    path: "artifacts/studio-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Настроить свет", exact: true })
    .click();
  await audit();
  await page.screenshot({
    path: "artifacts/settings-desktop.png",
    fullPage: true,
  });
  await closePanel(page);
  await page
    .getByRole("button", { name: "Библиотека сцен", exact: true })
    .click();
  await audit();
  await page.screenshot({
    path: "artifacts/scenes-desktop.png",
    fullPage: true,
  });
  await closePanel(page);
  await openTool(page, "Редактор узлов");
  await settleMotion(page);
  await page.screenshot({
    path: "artifacts/graph-desktop.png",
    fullPage: true,
  });
});

for (const width of [320, 390, 768]) {
  test(`home and sheets work without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await readyPreview(page);
    await expectNoOverflow(page);
    if (width === 390)
      await page.screenshot({
        path: "artifacts/studio-mobile.png",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Настроить свет", exact: true })
      .click();
    await expectNoOverflow(page);
    await closePanel(page);
    await page
      .getByRole("button", { name: "Библиотека сцен", exact: true })
      .click();
    await expectNoOverflow(page);
    await closePanel(page);
    for (const name of [
      "Устройства",
      "Расположение LED",
      "Таймлайн",
      "Редактор узлов",
    ]) {
      await openTool(page, name);
      await expectNoOverflow(page);
      await closePanel(page);
    }
  });
}
