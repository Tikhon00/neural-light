import { useState } from "react";
import { Radio, Plus, Trash2, Cable, Info } from "lucide-react";
import type { Controller, Telemetry } from "../engine/types";
import type { LightRuntime } from "../runtime/runtime";
export function Devices({
  devices,
  setDevices,
  runtime,
  telemetry,
}: {
  devices: Controller[];
  setDevices: (d: Controller[]) => void;
  runtime: LightRuntime;
  telemetry: Telemetry;
}) {
  const [adding, setAdding] = useState(false),
    [name, setName] = useState("Моя LED-лента"),
    [host, setHost] = useState(""),
    [count, setCount] = useState(240),
    [error, setError] = useState("");
  const patch = (id: string, p: Partial<Controller>) =>
    setDevices(devices.map((d) => (d.id === id ? { ...d, ...p } : d)));
  return (
    <section className="devices-page">
      <div className="section-page-heading">
        <div>
          <h2>Подключите свет</h2>
          <p>Контроллер NEURAL LIGHT NODE или WLED должен быть в одной сети с Mac.</p>
        </div>
        <button
          className="primary"
          onClick={() => setAdding(true)}
          disabled={devices.length >= 16}
        >
          <Plus size={16} /> Добавить контроллер
        </button>
      </div>
      {!runtime.native && (
        <div className="notice">
          <Info size={18} />
          <div>
            <strong>Передача света доступна в приложении для Mac</strong>
            <p>Здесь можно заранее добавить устройства.</p>
          </div>
        </div>
      )}
      {adding && (
        <form
          className="device-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[a-zA-Z0-9.:-]+$/.test(host) || host.length > 253) {
              setError(
                "Укажите IP-адрес или имя, например 192.168.1.50 или wled.local.",
              );
              return;
            }
            setDevices([
              ...devices,
              {
                id: crypto.randomUUID(),
                name,
                host,
                count,
                offset: 0,
                protocol: "ddp",
                enabled: false,
                latencyMs: 0,
                budgetKbps: 2000,
              },
            ]);
            setAdding(false);
            setHost("");
            setError("");
          }}
        >
          <label>
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            IP-адрес или .local
            <input
              value={host}
              placeholder="192.168.1.50"
              onChange={(e) => setHost(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            LED
            <input
              type="number"
              value={count}
              min={1}
              max={8192}
              onChange={(e) => setCount(Number(e.target.value))}
              required
            />
          </label>
          <div className="button-row">
            <button type="submit" className="primary">
              Добавить
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setAdding(false)}
            >
              Отмена
            </button>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {devices.length === 0 ? (
        <div className="empty-devices">
          <Cable size={40} strokeWidth={1} />
          <h3>Пока без устройств</h3>
          <p>
            Здесь появятся ваши ленты. До подключения можно спокойно выбрать
            эффект и настроить свет в предпросмотре.
          </p>
        </div>
      ) : (
        devices.map((d) => {
          const stat = telemetry.devices.find((s) => s.id === d.id);
          return (
            <article className="device-card" key={d.id}>
              <div className="device-title">
                <Radio size={19} />
                <div>
                  <h3>{d.name}</h3>
                  <span>
                    {d.host} · {d.count} LED
                  </span>
                </div>
                <span className="device-status">
                  {stat?.status ||
                    (d.enabled ? "Ожидает движок" : "Вывод выключен")}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Удалить ${d.name}`}
                  onClick={() =>
                    setDevices(devices.filter((item) => item.id !== d.id))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <details className="device-settings">
                <summary>Настройки устройства</summary>
                <div className="device-fields">
                  <label>
                    Протокол
                    <select
                      value={d.protocol}
                      onChange={(e) =>
                        patch(d.id, {
                          protocol: e.target.value as "ddp" | "dnrgb",
                        })
                      }
                    >
                      <option value="ddp">DDP · 4048</option>
                      <option value="dnrgb">DNRGB · 21324</option>
                    </select>
                  </label>
                  <label>
                    Первый LED сцены
                    <input
                      type="number"
                      min={0}
                      max={8192 - d.count}
                      value={d.offset}
                      onChange={(e) =>
                        patch(d.id, {
                          offset: Math.max(
                            0,
                            Math.min(8192 - d.count, Number(e.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Измеренная задержка, мс
                    <input
                      type="number"
                      min={0}
                      max={500}
                      step=".5"
                      value={d.latencyMs}
                      onChange={(e) =>
                        patch(d.id, {
                          latencyMs: Math.max(
                            0,
                            Math.min(500, Number(e.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Лимит сети, кбит/с
                    <input
                      type="number"
                      min={20}
                      max={100000}
                      value={d.budgetKbps}
                      onChange={(e) =>
                        patch(d.id, {
                          budgetKbps: Math.max(
                            20,
                            Math.min(100000, Number(e.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                {stat && (
                  <p className="device-metrics">
                    {stat.fps.toFixed(0)} FPS · отправлено {stat.sent} ·
                    пропущено {stat.dropped}
                  </p>
                )}
              </details>
              <div className="device-footer">
                {!stat && d.latencyMs === 0 && (
                  <span>Доставка и задержка LED ещё не измерены</span>
                )}
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    disabled={!runtime.native}
                    onChange={(e) => patch(d.id, { enabled: e.target.checked })}
                  />
                  <span className="switch" /> Передавать свет
                </label>
              </div>
            </article>
          );
        })
      )}
      <details className="calibration">
        <summary>Калибровка задержки</summary>
        <p>
          Снимите экран и LED на камеру 120/240 FPS и сравните кадры. Укажите
          полученную задержку в настройках каждого устройства — движок подождёт
          более медленные ленты перед отправкой на быстрые.
        </p>
        <div className="button-row">
          <button
            className="secondary"
            disabled={!runtime.native}
            onClick={() => runtime.ping()}
          >
            Измерить связь с движком
          </button>
          <span>
            {telemetry.rttMs === null
              ? "RTT: не измерено"
              : `Локальный RTT: ${telemetry.rttMs.toFixed(2)} мс`}
          </span>
        </div>
        <p className="helper">
          Эта проверка измеряет только связь с движком на Mac. UDP не
          подтверждает показ кадра, поэтому задержку самого света нужно измерить
          отдельно.
        </p>
      </details>
    </section>
  );
}
