import { emptyFeatures, type Features } from "./types";

/** Radix-2 FFT. Reuses all work buffers; magnitude is Hann coherent-gain corrected. */
export class AudioAnalyzer {
  readonly size: number;
  private real: Float64Array;
  private imag: Float64Array;
  private window: Float64Array;
  private previous: Float64Array;
  private flux: number[] = [];
  private beats: number[] = [];
  private lastBeat = -10;
  private envelope = 0;
  constructor(size = 2048) {
    if (size < 64 || (size & (size - 1)) !== 0)
      throw new Error("FFT size must be a power of two ≥ 64");
    this.size = size;
    this.real = new Float64Array(size);
    this.imag = new Float64Array(size);
    this.window = Float64Array.from(
      { length: size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
    );
    this.previous = new Float64Array(size / 2);
  }
  analyze(samples: Float32Array, sampleRate: number, time: number): Features {
    const n = this.size,
      re = this.real,
      im = this.imag;
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[i] || 0;
      re[i] = v * this.window[i];
      im[i] = 0;
      rms += v * v;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
      }
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = (-2 * Math.PI) / length,
        wr = Math.cos(angle),
        wi = Math.sin(angle);
      for (let i = 0; i < n; i += length) {
        let ur = 1,
          ui = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = i + j,
            b = a + length / 2,
            vr = re[b] * ur - im[b] * ui,
            vi = re[b] * ui + im[b] * ur;
          re[b] = re[a] - vr;
          im[b] = im[a] - vi;
          re[a] += vr;
          im[a] += vi;
          const next = ur * wr - ui * wi;
          ui = ur * wi + ui * wr;
          ur = next;
        }
      }
    }
    let flux = 0;
    for (let i = 0; i < n / 2; i++) {
      const magnitude = (Math.hypot(re[i], im[i]) * 4) / n;
      flux += Math.max(0, magnitude - this.previous[i]);
      this.previous[i] = magnitude;
    }
    const average =
      this.flux.reduce((a, b) => a + b, 0) / (this.flux.length || 1);
    const deviation = Math.sqrt(
      this.flux.reduce((a, b) => a + (b - average) ** 2, 0) /
        (this.flux.length || 1),
    );
    const onset =
      this.flux.length > 10 &&
      flux > average + Math.max(0.015, deviation * 1.4) &&
      time - this.lastBeat > 0.28 &&
      rms / n > 0.0001;
    if (onset) {
      this.beats.push(time);
      this.beats = this.beats.slice(-12);
      this.lastBeat = time;
      this.envelope = 1;
    } else this.envelope *= 0.87;
    this.flux.push(flux);
    if (this.flux.length > 43) this.flux.shift();
    const intervals = this.beats
      .slice(1)
      .map((v, i) => v - this.beats[i])
      .filter((v) => v > 0.28 && v < 1.5)
      .sort((a, b) => a - b);
    const bpm =
      intervals.length >= 3 && time - this.lastBeat < 3
        ? Math.round(60 / intervals[Math.floor(intervals.length / 2)])
        : 0;
    const energy = (lo: number, hi: number) => {
      let sum = 0;
      const start = Math.max(1, Math.floor((lo / sampleRate) * n));
      const end = Math.min(n / 2, Math.ceil((hi / sampleRate) * n));
      for (let i = start; i < end; i++) sum += this.previous[i] ** 2;
      return Math.min(1, Math.sqrt(sum) * 2.2);
    };
    const bands = Array.from({ length: 48 }, (_, i) =>
      energy(
        30 * (16000 / 30) ** (i / 48),
        30 * (16000 / 30) ** ((i + 1) / 48),
      ),
    );
    return {
      bands,
      bass: energy(30, 250),
      mid: energy(250, 2500),
      high: energy(2500, 16000),
      rms: Math.sqrt(rms / n),
      beat: this.envelope,
      bpm,
      capturedAt: time,
    };
  }
}

/** A deterministic 120 BPM percussion/ambient signal, analysed like a microphone. */
export function demoPCM(
  buffer: Float32Array,
  time: number,
  sampleRate = 48000,
): void {
  for (let i = 0; i < buffer.length; i++) {
    const t = time - (buffer.length - i) / sampleRate,
      phase = ((t % 0.5) + 0.5) % 0.5;
    const kick =
      Math.sin(2 * Math.PI * (58 * t)) * Math.exp(-phase * 23) * 0.62;
    const pad =
      Math.sin(t * 2 * Math.PI * 220) * 0.08 +
      Math.sin(t * 2 * Math.PI * 329.63) * 0.055;
    const hat =
      Math.sin(t * 2 * Math.PI * 6700) *
      Math.exp(-(((t % 0.25) + 0.25) % 0.25) * 75) *
      0.13;
    buffer[i] = kick + pad + hat;
  }
}
export const silence = emptyFeatures;
