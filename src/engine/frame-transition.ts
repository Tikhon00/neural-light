const MAX_CHANNELS = 8192 * 3;

/** A bounded snapshot-to-live fade. Destination pixels are rendered afresh
 * before every apply; audio and effect motion remain live throughout. */
export class FrameTransition {
  private readonly source = new Uint8Array(MAX_CHANNELS);
  private length = 0;
  private startedAt = 0;
  private duration = 0;

  begin(current: Uint8Array, now: number, durationMs: number) {
    this.cancel();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      current.length === 0 ||
      current.length > MAX_CHANNELS ||
      current.length % 3 !== 0
    )
      return;
    // A rapid second selection snapshots the pixels currently displayed,
    // including any incomplete fade, rather than jumping to an older scene.
    this.source.set(current);
    this.length = current.length;
    this.startedAt = now;
    this.duration = Math.min(600, durationMs);
  }

  cancel() {
    this.duration = 0;
    this.length = 0;
  }

  apply(destination: Uint8Array, now: number, blackout = false) {
    if (blackout) {
      destination.fill(0);
      this.cancel();
      return;
    }
    if (!this.duration) return;
    if (destination.length !== this.length || !Number.isFinite(now)) {
      this.cancel();
      return;
    }
    const progress = Math.max(0, (now - this.startedAt) / this.duration);
    if (progress >= 1) {
      this.cancel();
      return;
    }
    const mix = progress * progress * (3 - 2 * progress);
    for (let i = 0; i < destination.length; i++) {
      destination[i] = Math.round(
        this.source[i] + (destination[i] - this.source[i]) * mix,
      );
    }
  }
}
