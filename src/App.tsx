import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  GitBranch,
  Layers,
  Ellipsis,
  Plus,
  Radio,
  X,
  Zap,
  Pause,
  Play,
  SlidersHorizontal,
  Sun,
  AudioLines,
  Spline,
  ListVideo,
  Monitor,
} from "lucide-react";
import { LightRuntime } from "./runtime/runtime";
import { loadScene, parseScene, applyPreset, presets } from "./engine/presets";
import {
  compileGraph,
  defaultGraph,
  graphFromLayers,
  type Graph,
} from "./engine/graph";
import type { Controller, Effect, Scene, Source } from "./engine/types";
import { Simulator } from "./components/Simulator";
import { Spectrum } from "./components/Spectrum";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { SourcePanel } from "./components/SourcePanel";
import { EffectArt, Scenes } from "./components/Scenes";
import { NodeEditor } from "./components/NodeEditor";
import { Mapping, downloadJSON } from "./components/Mapping";
import { Devices } from "./components/Devices";
import "./styles.css";
import "./styles-glass.css";
import "./styles-motion.css";
import "./styles-library.css";
import "./styles-studio.css";
import { useAnimatedDialog } from "./components/useAnimatedDialog";
import { SceneName } from "./components/SceneName";

type View =
  | "studio"
  | "settings"
  | "sound"
  | "scenes"
  | "graph"
  | "mapping"
  | "devices"
  | "timeline"
  | "diagnostics"
  | "tools";
const panelTitles: Record<Exclude<View, "studio">, string> = {
  settings: "Настроить свет",
  sound: "Звук и экран",
  scenes: "Сцены",
  graph: "Редактор узлов",
  mapping: "Расположение LED",
  devices: "Устройства",
  timeline: "Таймлайн",
  diagnostics: "Диагностика",
  tools: "Ещё",
};
const shortNames = ["Сияние", "Ритм", "Океан", "Огонь", "Спектр", "Экран"];
function loadSaved(): Scene[] {
  try {
    return (
      JSON.parse(
        localStorage.getItem("neural-light.presets.v1") || "[]",
      ) as unknown[]
    )
      .slice(0, 100)
      .map(parseScene);
  } catch {
    return [];
  }
}
function initialControllers(): Controller[] {
  try {
    const list = JSON.parse(
      localStorage.getItem("neural-light.devices.v1") || "[]",
    );
    return Array.isArray(list)
      ? list
          .filter(
            (d) =>
              typeof d.id === "string" &&
              typeof d.host === "string" &&
              d.count >= 1 &&
              d.count <= 8192,
          )
          .slice(0, 16)
          .map((d) => ({ ...d, enabled: false }))
      : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [scene, setScene] = useState(loadScene),
    [runtime] = useState(() => new LightRuntime(scene));
  const [view, setView] = useState<View>("studio"),
    [graph, setGraph] = useState(
      () => scene.graph || graphFromLayers(scene.layers),
    ),
    [saved, setSaved] = useState(loadSaved),
    [devices, setDevices] = useState<Controller[]>(initialControllers);
  const [monitor, setMonitor] = useState(false),
    [monitorPending, setMonitorPending] = useState(false),
    [busy, setBusy] = useState(false),
    [native, setNative] = useState(false);
  const [previewMode, setPreviewMode] = useState<"room" | "mapping">(() => {
    try {
      return localStorage.getItem("neural-light.preview.v1") === "mapping"
        ? "mapping"
        : "room";
    } catch {
      return "room";
    }
  });
  const [toast, setToast] = useState<{
      message: string;
      error: boolean;
      undo?: () => void;
    } | null>(null),
    [modal, setModal] = useState<"save" | "help" | null>(null),
    [saveName, setSaveName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    panel = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null),
    sourceVersion = useRef(0);
  const panelView =
    useAnimatedDialog(panel, view === "studio" ? null : view) || "studio";
  const displayedModal = useAnimatedDialog(dialog, modal);
  const telemetry = useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const update = useCallback(
    (patch: Partial<Scene>) => setScene((prev) => ({ ...prev, ...patch })),
    [],
  );
  useEffect(() => {
    runtime.onError = (message) => notify(message, true);
    runtime.onSourceChanged = (source) => update({ source });
    runtime.onNativeChange = () => {
      setNative(runtime.native);
      if (!runtime.native) update({ source: "demo" });
    };
    runtime.start();
    return () => runtime.close();
  }, [runtime, notify, update]);
  useEffect(() => {
    runtime.update(scene);
    try {
      localStorage.setItem("neural-light.scene.v1", JSON.stringify(scene));
    } catch {
      notify(
        "Недостаточно места для автосохранения. Экспортируйте сцену.",
        true,
      );
    }
  }, [scene, runtime, notify]);
  useEffect(() => {
    runtime.devices(devices);
    try {
      localStorage.setItem("neural-light.devices.v1", JSON.stringify(devices));
    } catch {
      /* explicit scene export remains available */
    }
  }, [devices, native, runtime]);
  useEffect(() => {
    try {
      localStorage.setItem("neural-light.preview.v1", previewMode);
    } catch {
      // A preview preference must never interrupt light control.
    }
  }, [previewMode]);
  useEffect(() => {
    if (!toast || toast.undo) return;
    const id = window.setTimeout(
      () => setToast(null),
      toast.error ? 8000 : 3500,
    );
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      if (preference.matches) {
        runtime.transitionScene(0);
        runtime.update(runtime.scene);
      }
    };
    preference.addEventListener("change", settle);
    return () => preference.removeEventListener("change", settle);
  }, [runtime]);
  const transitionScene = () =>
    runtime.transitionScene(
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
    );
  const toggleMonitor = async () => {
    if (monitorPending) return;
    setMonitorPending(true);
    const generation = sourceVersion.current;
    try {
      await runtime.monitor(!monitor);
      if (generation === sourceVersion.current) setMonitor(!monitor);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setMonitorPending(false);
    }
  };
  const save = () => {
    setView("studio");
    setSaveName(scene.name);
    setModal("save");
  };
  const selectPreset = (effect: Effect) => {
    transitionScene();
    setScene((prev) => applyPreset(prev, effect));
    const next = structuredClone(defaultGraph);
    next.nodes[1].effect = effect;
    setGraph(next);
    setView("studio");
  };
  const changeGraph = useCallback(
    (next: Graph) => {
      try {
        const layers = compileGraph(next);
        setGraph(next);
        setScene((prev) => ({
          ...prev,
          layers,
          graph: next,
          effect: layers[0]?.effect || prev.effect,
          timelineEnabled:
            JSON.stringify(layers) === JSON.stringify(prev.layers)
              ? prev.timelineEnabled
              : false,
        }));
      } catch (e) {
        notify((e as Error).message, true);
      }
    },
    [notify],
  );
  const selectSource = async (source: Source) => {
    const generation = ++sourceVersion.current;
    setBusy(true);
    try {
      await runtime.monitor(false);
      setMonitor(false);
      await runtime.selectSource(source);
      if (generation === sourceVersion.current) update({ source });
    } catch (e) {
      update({ source: "demo" });
      notify(`Источник не включён. ${(e as Error).message}`, true);
    } finally {
      if (generation === sourceVersion.current) setBusy(false);
    }
  };
  const restore = (s: Scene) => {
    transitionScene();
    setScene({ ...structuredClone(s), source: scene.source, playing: true });
    setGraph(s.graph || graphFromLayers(s.layers));
    setView("studio");
    notify("Сцена открыта");
  };
  const removeSaved = (index: number) => {
    const removed = saved[index];
    const next = saved.filter((_, i) => i !== index);
    try {
      localStorage.setItem("neural-light.presets.v1", JSON.stringify(next));
      setSaved(next);
      setToast({
        message: "Сцена удалена",
        error: false,
        undo: () => {
          // Read the latest library so undo never discards a subsequent save.
          const current = loadSaved();
          current.splice(Math.min(index, current.length), 0, removed);
          try {
            localStorage.setItem(
              "neural-light.presets.v1",
              JSON.stringify(current),
            );
            setSaved(current);
            notify("Сцена восстановлена");
          } catch {
            notify("Не удалось восстановить сцену: недостаточно места.", true);
          }
        },
      });
    } catch {
      notify("Не удалось удалить сцену. Попробуйте ещё раз.", true);
    }
  };
  const sending = native && devices.some((device) => device.enabled);
  const description = scene.timelineEnabled
    ? "Сцены сменяются автоматически"
    : scene.layers.length > 1
      ? "Ваше сочетание световых эффектов"
      : presets.find((preset) => preset.id === scene.effect)?.description;
  const feedback = toast && (
    <div
      className={`toast ${toast.error ? "toast-error" : ""}`}
      role={toast.error ? "alert" : "status"}
    >
      {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="toast-undo" onClick={toast.undo}>
          Вернуть
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Закрыть сообщение"
        onClick={() => setToast(null)}
      >
        <X size={15} />
      </button>
    </div>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Перейти к свету
      </a>
      <header className="app-header">
        <div className="brand" aria-label="NEURAL LIGHT">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M4 25V7l12 18V7M22 7v18h7" />
          </svg>
          <span>neural light</span>
        </div>
        <nav className="header-controls glass" aria-label="Управление светом">
          <button
            className="library-button"
            aria-label="Библиотека сцен"
            onClick={() => setView("scenes")}
          >
            <Layers size={18} />
            <span>Сцены</span>
          </button>
          <span className="control-divider" />
          <button
            className="library-button settings-button"
            aria-label="Настроить свет"
            title="Настроить свет"
            onClick={() => setView("settings")}
          >
            <SlidersHorizontal size={19} />
            <span>Настроить</span>
          </button>
          <button
            className="icon-button"
            aria-label="Ещё"
            title="Ещё"
            onClick={() => setView("tools")}
          >
            <Ellipsis size={22} />
          </button>
        </nav>
      </header>
      <main id="workspace" className="light-space" tabIndex={-1}>
        <Simulator runtime={runtime} immersive previewMode={previewMode} />
        <div className="scene-heading">
          <SceneName name={scene.name} />
          <p>
            {scene.brightness === 0
              ? "Яркость 0% · свет выключен"
              : !scene.playing
                ? "На паузе · свет остаётся включённым"
                : description}
          </p>
          <div
            className="preview-controls"
            role="group"
            aria-label="Вид предпросмотра"
          >
            <button
              aria-pressed={previewMode === "room"}
              onClick={() => setPreviewMode("room")}
            >
              За монитором
            </button>
            <button
              aria-pressed={previewMode === "mapping"}
              onClick={() => setPreviewMode("mapping")}
            >
              Схема ленты
            </button>
          </div>
        </div>
        {scene.layers.some((l) => l.effect === "screen") &&
          scene.source !== "screen" && (
            <button
              className="screen-prompt glass"
              disabled={busy}
              onClick={() => void selectSource("screen")}
            >
              <Monitor size={18} />
              Выбрать экран
            </button>
          )}
        <div className="studio-footer">
          <div className="preview-caption">
            <span>
              {sending ? "Передача на ленту включена" : "Виртуальная лента"}
            </span>
            <span aria-hidden="true">·</span>
            <button onClick={() => setView("devices")}>
              {sending || devices.length ? "Устройства" : "Подключить свою"}
              <ChevronRight size={13} />
            </button>
          </div>
          <div className="light-dock glass" aria-label="Сцена и яркость">
            <div
              className="mood-picker"
              role="group"
              aria-label="Быстрые сцены"
            >
              {presets.map((p, i) => (
                <button
                  key={p.id}
                  className={`mood ${scene.effect === p.id ? "is-selected" : ""}`}
                  aria-label={p.name}
                  aria-pressed={scene.effect === p.id}
                  onClick={() => selectPreset(p.id)}
                >
                  <span className="mood-orb">
                    <EffectArt effect={p.id} palette={p.palette} />
                  </span>
                  <span>{shortNames[i]}</span>
                </button>
              ))}
            </div>
            <div className="playback-controls">
              <button
                className="play-toggle"
                aria-label={scene.playing ? "Пауза" : "Воспроизвести"}
                title={scene.playing ? "Пауза" : "Воспроизвести"}
                onClick={() => update({ playing: !scene.playing })}
              >
                {scene.playing ? (
                  <Pause size={19} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
              <label className="brightness">
                <Sun size={19} />
                <span className="sr-only">Яркость</span>
                <input
                  aria-label="Яркость"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={scene.brightness}
                  onChange={(e) =>
                    update({ brightness: Number(e.target.value) })
                  }
                />
                <output>
                  {Math.round(scene.brightness * 100)}
                  <span>%</span>
                </output>
              </label>
              <span className="control-divider" />
              <button
                className="source-button"
                onClick={() => setView("sound")}
                aria-label="Выбрать источник звука"
                title="Выбрать источник звука"
              >
                <AudioLines size={19} />
                <span>
                  {scene.source === "demo"
                    ? "Деморитм"
                    : scene.source === "microphone"
                      ? "Микрофон"
                      : "Экран"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </main>
      <dialog
        ref={panel}
        className={`panel-dialog panel-${panelView}`}
        aria-labelledby="panel-title"
        onCancel={(e) => {
          e.preventDefault();
          setView("studio");
        }}
        onClick={(e) => {
          if (e.target === panel.current) setView("studio");
        }}
      >
        <div className="sheet-surface">
          <header className="sheet-heading">
            {[
              "graph",
              "mapping",
              "devices",
              "timeline",
              "diagnostics",
            ].includes(panelView) && (
              <button
                className="icon-button"
                aria-label="Назад к инструментам"
                onClick={() => setView("tools")}
              >
                <ChevronLeft size={21} />
              </button>
            )}
            <h2 id="panel-title">
              {panelView !== "studio" ? panelTitles[panelView] : ""}
            </h2>
            {panelView === "scenes" && saved.length > 0 && (
              <button className="text-button" onClick={save}>
                <Plus size={17} />
                Сохранить
              </button>
            )}
            <button
              className="icon-button close-sheet"
              aria-label="Закрыть панель"
              onClick={() => setView("studio")}
            >
              <X size={19} />
            </button>
          </header>
          {panelView !== "studio" && !displayedModal && feedback}
          <div className="sheet-content" key={panelView}>
            {panelView === "settings" && (
              <Inspector scene={scene} update={update} />
            )}
            {panelView === "sound" && (
              <SourcePanel
                scene={scene}
                source={selectSource}
                busy={busy}
                monitor={monitor}
                monitorPending={monitorPending}
                toggleMonitor={toggleMonitor}
              />
            )}
            {panelView === "tools" && (
              <div className="tools-list">
                <button onClick={save}>
                  <Bookmark size={20} />
                  <span>Сохранить сцену</span>
                </button>
                <button
                  onClick={() => {
                    downloadJSON(scene, "neural-light-scene.json");
                    setView("studio");
                  }}
                >
                  <ArrowDownToLine size={20} />
                  <span>Экспортировать сцену</span>
                </button>
                <div className="menu-separator" />
                <button onClick={() => setView("devices")}>
                  <Radio size={20} />
                  <span>Устройства</span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => setView("mapping")}>
                  <Spline size={20} />
                  <span>Расположение LED</span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => setView("timeline")}>
                  <ListVideo size={20} />
                  <span>Таймлайн</span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => setView("graph")}>
                  <GitBranch size={20} />
                  <span>Редактор узлов</span>
                  <ChevronRight size={16} />
                </button>
                <div className="menu-separator" />
                <button onClick={() => setView("diagnostics")}>
                  <Activity size={20} />
                  <span>Диагностика</span>
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={() => {
                    setView("studio");
                    setModal("help");
                  }}
                >
                  <CircleHelp size={20} />
                  <span>Как это работает</span>
                </button>
              </div>
            )}
            {panelView === "scenes" && (
              <Scenes
                select={selectPreset}
                saved={saved}
                restore={restore}
                remove={removeSaved}
                save={save}
                selectedEffect={scene.effect}
                importScene={() => file.current?.click()}
              />
            )}
            {panelView === "graph" && (
              <NodeEditor
                graph={graph}
                onChange={changeGraph}
                error={(message) => notify(message, true)}
              />
            )}
            {panelView === "mapping" && (
              <Mapping
                scene={scene}
                update={update}
                runtime={runtime}
                error={(message) => notify(message, true)}
              />
            )}
            {panelView === "devices" && (
              <Devices
                devices={devices}
                setDevices={setDevices}
                runtime={runtime}
                telemetry={telemetry}
              />
            )}
            {panelView === "timeline" && (
              <Timeline
                scene={scene}
                update={update}
                elapsed={telemetry.elapsed}
                runtime={runtime}
              />
            )}
            {panelView === "diagnostics" && (
              <>
                <dl className="diagnostic-values">
                  <div>
                    <dt>Рендеринг</dt>
                    <dd>{telemetry.backend}</dd>
                  </div>
                  <div>
                    <dt>Частота кадров</dt>
                    <dd>{telemetry.fps.toFixed(0)} FPS</dd>
                  </div>
                  <div>
                    <dt>Время расчёта</dt>
                    <dd>{telemetry.renderMs.toFixed(2)} мс</dd>
                  </div>
                  <div>
                    <dt>Светодиоды</dt>
                    <dd>{scene.count} LED</dd>
                  </div>
                </dl>
                <Spectrum
                  runtime={runtime}
                  telemetry={telemetry}
                  monitor={monitor}
                  onMonitor={toggleMonitor}
                />
              </>
            )}
          </div>
        </div>
      </dialog>
      {panelView === "studio" && !displayedModal && feedback}
      <dialog
        className="message-dialog"
        aria-label={
          displayedModal === "save" ? "Сохранить сцену" : "Как это работает"
        }
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          setModal(null);
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
      >
        <div className="dialog-inner">
          {displayedModal && feedback}
          <button
            className="dialog-close icon-button"
            aria-label="Закрыть окно"
            onClick={() => setModal(null)}
          >
            <X size={18} />
          </button>
          {displayedModal === "save" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const nextScene = {
                    ...scene,
                    name: saveName.trim() || scene.name,
                  },
                  next = [nextScene, ...saved].slice(0, 100);
                try {
                  localStorage.setItem(
                    "neural-light.presets.v1",
                    JSON.stringify(next),
                  );
                  setSaved(next);
                  update({ name: nextScene.name });
                  setModal(null);
                  notify("Сцена сохранена в вашей библиотеке");
                } catch {
                  notify(
                    "Не удалось сохранить. Используйте экспорт сцены.",
                    true,
                  );
                }
              }}
            >
              <Bookmark size={24} />
              <h2>Сохранить этот свет</h2>
              <p>
                Настройки, расположение LED и таймлайн останутся в вашей
                библиотеке.
              </p>
              <label>
                Название сцены
                <input
                  autoFocus
                  data-dialog-autofocus
                  required
                  maxLength={100}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </label>
              <button type="submit" className="primary full-width">
                Сохранить сцену
              </button>
            </form>
          ) : (
            <>
              <Zap size={26} />
              <h2>Ваш свет, за три шага</h2>
              <ol className="help-steps">
                <li>
                  <strong>Выберите сцену</strong>
                  <p>
                    Нажмите на сцену в нижней панели. Свет сразу начнёт
                    реагировать на деморитм.
                  </p>
                </li>
                <li>
                  <strong>Сделайте её своей</strong>
                  <p>
                    Яркость — внизу, цвет и скорость — в «Настроить». Нажмите
                    «Деморитм», чтобы послушать его или выбрать свой звук.
                  </p>
                </li>
                <li>
                  <strong>Подключите настоящие LED</strong>
                  <p>
                    Нажмите «Подключить свою», добавьте адрес WLED и включите
                    передачу света.
                  </p>
                </li>
              </ol>
              <p className="helper">
                Рабочее место — пример освещения. «Схема ленты» показывает
                расположение ваших светодиодов. Потяните изображение, чтобы
                повернуть его. Никакие аудио- или видеоданные не отправляются в
                облако.
              </p>
              <button
                className="primary full-width"
                onClick={() => setModal(null)}
              >
                Начать создавать
              </button>
            </>
          )}
        </div>
      </dialog>
      <input
        ref={file}
        type="file"
        hidden
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 2_000_000) throw new Error("Файл больше 2 МБ");
            const imported = parseScene(JSON.parse(await f.text()));
            restore(imported);
          } catch (err) {
            notify(`Не удалось открыть сцену: ${(err as Error).message}`, true);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
