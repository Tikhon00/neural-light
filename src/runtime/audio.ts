import { AudioAnalyzer, demoPCM } from "../engine/dsp";
import { emptyFeatures, type Features, type Source } from "../engine/types";

export class AudioInput {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private video?: HTMLVideoElement;
  private monitor?: AudioBufferSourceNode;
  private monitorVersion = 0;
  private canvas = document.createElement("canvas");
  private fft = new AudioAnalyzer();
  private samples = new Float32Array(2048);
  source: Source = "demo";
  color = [0, 0, 0];
  private demoEpoch = 0;
  onEnded: () => void = () => {};
  async select(source: Source) {
    this.stopCapture();
    this.fft = new AudioAnalyzer();
    this.source = "demo";
    if (source === "demo") return;
    if (!navigator.mediaDevices)
      throw new Error(
        "Захват недоступен. Откройте приложение macOS или localhost в браузере.",
      );
    const stream =
      source === "microphone"
        ? await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 15 },
            audio: true,
          });
    this.stream = stream;
    if (stream.getAudioTracks().length) {
      this.context ||= new AudioContext();
      await this.context.resume();
      this.node = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.node.connect(this.analyser);
    }
    if (source === "screen") {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.srcObject = stream;
      await this.video.play();
      this.canvas.width = 32;
      this.canvas.height = 18;
    }
    this.source = source;
    stream.getTracks().forEach((track) =>
      track.addEventListener(
        "ended",
        () => {
          this.stopCapture();
          this.onEnded();
        },
        { once: true },
      ),
    );
  }
  read(time: number): Features {
    if (this.source === "demo") demoPCM(this.samples, time - this.demoEpoch);
    else if (this.analyser) this.analyser.getFloatTimeDomainData(this.samples);
    else this.samples.fill(0);
    if (this.video && this.video.readyState >= 2) {
      const ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(this.video, 0, 0, 32, 18);
      const pixels = ctx.getImageData(0, 0, 32, 18).data,
        sums = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4)
        for (let c = 0; c < 3; c++) sums[c] += pixels[i + c];
      this.color = sums.map((v) => v / (32 * 18 * 255));
    }
    return this.fft.analyze(
      this.samples,
      this.source === "demo" ? 48000 : this.context?.sampleRate || 48000,
      time,
    );
  }
  async setMonitor(enabled: boolean, offset = 0) {
    const version = ++this.monitorVersion;
    this.monitor?.stop();
    this.monitor = undefined;
    if (!enabled) return;
    this.context ||= new AudioContext();
    await this.context.resume();
    // Permission / audio-context activation can finish after a newer stop.
    if (version !== this.monitorVersion) return;
    const length = this.context.sampleRate * 8,
      pcm = new Float32Array(length);
    demoPCM(pcm, 8, this.context.sampleRate);
    const buffer = this.context.createBuffer(
      1,
      length,
      this.context.sampleRate,
    );
    buffer.copyToChannel(pcm, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const volume = this.context.createGain();
    volume.gain.value = 0.16;
    source.connect(volume).connect(this.context.destination);
    source.start(0, ((offset % 8) + 8) % 8);
    this.demoEpoch = performance.now() / 1000 - offset;
    this.monitor = source;
  }
  stopCapture() {
    this.node?.disconnect();
    this.node = undefined;
    this.analyser = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video?.pause();
    this.video = undefined;
    this.source = "demo";
  }
  close() {
    this.monitorVersion++;
    this.stopCapture();
    this.monitor?.stop();
    this.monitor = undefined;
    this.context?.close();
  }
}
export const initialFeatures = emptyFeatures;
