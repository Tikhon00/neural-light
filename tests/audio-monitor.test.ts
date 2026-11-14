import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioInput } from "../src/runtime/audio";

afterEach(() => vi.unstubAllGlobals());

describe("demo audio activation", () => {
  it.each(["disable", "close"] as const)(
    "does not start delayed audio after %s",
    async (action) => {
      let activate!: () => void;
      const activation = new Promise<void>((resolve) => {
        activate = resolve;
      });
      const start = vi.fn();
      const createSource = vi.fn(() => ({
        connect: (target: unknown) => target,
        start,
        stop: vi.fn(),
      }));
      vi.stubGlobal("document", { createElement: () => ({}) });
      vi.stubGlobal(
        "AudioContext",
        class {
          sampleRate = 48000;
          destination = {};
          resume = () => activation;
          close = vi.fn();
          createBuffer = () => ({ copyToChannel: vi.fn() });
          createBufferSource = createSource;
          createGain() {
            return { gain: { value: 0 }, connect: vi.fn() };
          }
        },
      );

      const audio = new AudioInput();
      const pending = audio.setMonitor(true);
      if (action === "disable") await audio.setMonitor(false);
      else audio.close();
      activate();
      await pending;

      expect(createSource).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    },
  );
});
