import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "./styles.css";

interface FirmwareManifest {
  name: string;
  version: string;
  builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number }> }>;
}

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing installer element: ${selector}`);
  return result;
}

const status = element("#install-status");
const controls = element("#supported-controls");
const unavailable = element("#unavailable-controls");
const browserLink = element<HTMLAnchorElement>("#browser-link");
const retryButton = element<HTMLButtonElement>("#retry-button");
const connectButton = element<HTMLButtonElement>("#connect-button");
const consent = element<HTMLInputElement>("#erase-consent");
const installer = element("#web-installer");
const manifestUrl = new URL("./firmware/manifest.json", document.baseURI);
let ready = false;
let generation = 0;

function updateButton(): void {
  connectButton.disabled = !ready || !consent.checked;
}

consent.addEventListener("change", updateButton);
retryButton.addEventListener("click", () => void prepare());
installer.addEventListener("click", (event) => {
  // The third-party component listens on its activation slot. Gate all clicks,
  // including a click on the SVG nested inside a disabled button.
  if (!ready || !consent.checked) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, { capture: true });

function showUnavailable(message: string, options: { browser?: boolean; retry?: boolean } = {}): void {
  ready = false;
  updateButton();
  controls.hidden = true;
  unavailable.hidden = false;
  browserLink.hidden = !options.browser;
  retryButton.hidden = !options.retry;
  status.textContent = message;
  status.dataset.state = "unavailable";
}

function readManifest(value: unknown): FirmwareManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid manifest");
  const manifest = value as FirmwareManifest;
  if (manifest.name !== "NEURAL LIGHT NODE" || typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Unexpected firmware");
  }
  if (!Array.isArray(manifest.builds) || manifest.builds.length !== 1 || manifest.builds[0]?.chipFamily !== "ESP32") {
    throw new Error("Unexpected chip family");
  }
  const parts = manifest.builds[0].parts;
  if (!Array.isArray(parts) || parts.length !== 1) throw new Error("Expected one merged firmware image");
  for (const part of parts) {
    if (!part || typeof part.path !== "string" || part.offset !== 0) {
      throw new Error("Invalid firmware part");
    }
    const url = new URL(part.path, manifestUrl);
    if (url.origin !== location.origin || !url.pathname.endsWith(".bin")) throw new Error("Unexpected firmware source");
  }
  return manifest;
}

async function prepare(): Promise<void> {
  const attempt = ++generation;
  ready = false;
  updateButton();
  controls.hidden = true;
  unavailable.hidden = true;
  status.dataset.state = "loading";

  if (!window.isSecureContext) {
    showUnavailable("Для доступа к USB нужна защищённая страница. Открой установщик по HTTPS.");
    return;
  }
  const serial = (navigator as Navigator & { serial?: { requestPort?: unknown } }).serial;
  if (typeof serial?.requestPort !== "function") {
    showUnavailable("Установка доступна в Chrome или Edge на компьютере. Safari и iPhone не могут прошить плату через эту страницу.", { browser: true });
    return;
  }

  status.textContent = "Проверяем файлы прошивки…";
  try {
    const response = await fetch(manifestUrl, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("Manifest unavailable");
    const manifest = readManifest(await response.json());
    await Promise.all(manifest.builds[0].parts.map(async (part) => {
      const binary = await fetch(new URL(part.path, manifestUrl), { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!binary.ok || binary.headers.get("content-length") === "0" || binary.headers.get("content-type")?.includes("text/html")) {
        throw new Error("Firmware unavailable");
      }
    }));
    if (attempt !== generation) return;
    await import("esp-web-tools/dist/web/install-button.js");
    await customElements.whenDefined("esp-web-install-button");
    if (attempt !== generation) return;
    installer.setAttribute("manifest", manifestUrl.href);
    status.textContent = `Версия ${manifest.version} · файлы готовы`;
    status.dataset.state = "ready";
    controls.hidden = false;
    unavailable.hidden = true;
    ready = true;
    updateButton();
  } catch {
    if (attempt !== generation) return;
    showUnavailable("Не удалось загрузить прошивку. Проверь интернет и попробуй ещё раз. Установка пока недоступна.", { retry: true });
  }
}

void prepare();
