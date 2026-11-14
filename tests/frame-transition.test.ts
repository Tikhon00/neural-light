import { describe, expect, it } from "vitest";
import { FrameTransition } from "../src/engine/frame-transition";

describe("scene frame transitions", () => {
  it("begins at the displayed frame and finishes at the exact live output", () => {
    const transition = new FrameTransition();
    const previous = new Uint8Array([240, 0, 30]);
    transition.begin(previous, 100, 450);
    const start = new Uint8Array([0, 80, 250]);
    transition.apply(start, 100);
    expect(start).toEqual(previous);

    const middle = new Uint8Array([0, 80, 250]);
    transition.apply(middle, 325);
    expect([...middle]).toEqual([120, 40, 140]);

    // Destination is live, not a frozen picture from the time of selection.
    const end = new Uint8Array([10, 100, 200]);
    transition.apply(end, 550);
    expect([...end]).toEqual([10, 100, 200]);
    const later = new Uint8Array([70, 60, 40]);
    transition.apply(later, 1000);
    expect([...later]).toEqual([70, 60, 40]);
  });

  it("retargets a rapid scene selection from the currently blended light", () => {
    const transition = new FrameTransition();
    transition.begin(new Uint8Array([200, 0, 0]), 0, 400);
    const displayed = new Uint8Array([0, 0, 200]);
    transition.apply(displayed, 200);
    expect([...displayed]).toEqual([100, 0, 100]);
    transition.begin(displayed, 200, 400);
    const next = new Uint8Array([0, 200, 0]);
    transition.apply(next, 200);
    expect(next).toEqual(displayed);
    next.set([0, 200, 0]);
    transition.apply(next, 400);
    expect([...next]).toEqual([50, 100, 50]);
  });

  it("blackout immediately cancels a fade without resurrecting old pixels", () => {
    const transition = new FrameTransition();
    transition.begin(new Uint8Array([255, 255, 255]), 0, 450);
    const frame = new Uint8Array([100, 20, 5]);
    transition.apply(frame, 10, true);
    expect([...frame]).toEqual([0, 0, 0]);
    transition.apply(frame, 20);
    expect([...frame]).toEqual([0, 0, 0]);
  });

  it("zero duration cancels an existing fade for reduced motion", () => {
    const transition = new FrameTransition();
    transition.begin(new Uint8Array([200, 0, 0]), 0, 450);
    transition.begin(new Uint8Array([100, 0, 100]), 100, 0);
    const frame = new Uint8Array([0, 255, 0]);
    transition.apply(frame, 100);
    expect([...frame]).toEqual([0, 255, 0]);
  });

  it("cancels if the output topology changes instead of blending wrong LEDs", () => {
    const transition = new FrameTransition();
    transition.begin(new Uint8Array([200, 0, 0]), 0, 450);
    const frame = new Uint8Array([0, 30, 70, 10, 20, 30]);
    transition.apply(frame, 10);
    expect([...frame]).toEqual([0, 30, 70, 10, 20, 30]);
  });
});
