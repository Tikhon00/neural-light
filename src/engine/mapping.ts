import type { Layout, Point } from "./types";
export function makeMapping(layout: Layout, count: number): Point[] {
  if (!Number.isInteger(count) || count < 1 || count > 8192)
    throw new Error("LED count must be 1…8192");
  return Array.from({ length: count }, (_, i) => {
    const t = i / Math.max(1, count - 1);
    if (layout === "strip") return { x: t * 2 - 1, y: 0, z: 0 };
    if (layout === "matrix") {
      const cols = Math.ceil(Math.sqrt(count * 1.7)),
        row = Math.floor(i / cols),
        col = i % cols,
        rows = Math.ceil(count / cols);
      return {
        x: ((row % 2 ? cols - 1 - col : col) / Math.max(1, cols - 1)) * 2 - 1,
        y: (row / Math.max(1, rows - 1)) * 1.4 - 0.7,
        z: 0,
      };
    }
    if (layout === "helix")
      return {
        x: Math.cos(t * Math.PI * 6) * 0.7,
        y: t * 2 - 1,
        z: Math.sin(t * Math.PI * 6) * 0.7,
      };
    // Four physical arches, wired bottom-left → top → bottom-right.
    const arch = Math.min(3, Math.floor((i * 4) / count)),
      local = ((i * 4) / count - arch) * Math.PI;
    return {
      x: Math.cos(local) * (0.84 - arch * 0.045),
      y: Math.sin(local) * 1.45 - 0.65,
      z: (arch - 1.5) * 0.42,
    };
  });
}
export function validatePoints(
  value: unknown,
  count: number,
): value is Point[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every(
      (p) =>
        p &&
        ["x", "y", "z"].every(
          (k) =>
            typeof p[k] === "number" &&
            Number.isFinite(p[k]) &&
            Math.abs(p[k]) <= 100,
        ),
    )
  );
}
