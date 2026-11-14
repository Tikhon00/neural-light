type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];
type Project = (p: Vec3) => Vec2;

/** A contextual illustration of a strip behind a monitor, not installation mapping.
 * Static surfaces are rasterized only when the viewport or camera changes.
 * The bounded light pass reads the actual output frame without changing it.
 */
export class RoomPreview {
  private base = document.createElement("canvas");
  private objects = document.createElement("canvas");
  private key = "";
  private scale = 1;
  private wall = new Path2D();
  private desk = new Path2D();
  private lights: Vec2[] = [];
  private wallLights: Vec2[] = [];
  private deskLights: Vec2[] = [];

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number,
    stageTop: number,
    stageBottom: number,
    angle: number,
    frame: Uint8Array,
  ) {
    const key = `${width},${height},${dpr},${stageTop},${stageBottom},${angle}`;
    if (key !== this.key) {
      this.key = key;
      this.build(width, height, dpr, stageTop, stageBottom, angle);
    }
    ctx.drawImage(this.base, 0, 0, width, height);
    const count = Math.floor(frame.length / 3);
    const color = (fraction: number) => {
      // Average a small local neighbourhood to prevent sparse sampling flicker.
      const center = Math.min(count - 1, Math.floor(fraction * count));
      let r = 0,
        g = 0,
        b = 0,
        samples = 0;
      const radius = Math.max(1, Math.floor(count / 160));
      for (let n = -1; n <= 1; n++) {
        const index = Math.max(0, Math.min(count - 1, center + n * radius)) * 3;
        r += frame[index] || 0;
        g += frame[index + 1] || 0;
        b += frame[index + 2] || 0;
        samples++;
      }
      return [
        Math.round(r / samples),
        Math.round(g / samples),
        Math.round(b / samples),
      ] as const;
    };
    const spill = (
      points: Vec2[],
      clip: Path2D,
      radius: number,
      opacity: number,
    ) => {
      ctx.save();
      ctx.clip(clip);
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < points.length; i++) {
        const [r, g, b] = color(i / points.length);
        if (!(r || g || b)) continue;
        const [x, y] = points[i];
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
        glow.addColorStop(0.34, `rgba(${r},${g},${b},${opacity * 0.48})`);
        glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    };
    // Fourteen broad wall reflections and six softer reflections on the desk.
    spill(this.wallLights, this.wall, this.scale * 0.63, 0.63);
    spill(this.deskLights, this.desk, this.scale * 0.61, 0.18);
    ctx.drawImage(this.objects, 0, 0, width, height);
    // A continuous diffuser, with no decorative LED dots or invented colour.
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "screen";
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth =
        pass === 0
          ? Math.max(2.8, this.scale * 0.021)
          : Math.max(0.8, this.scale * 0.006);
      ctx.globalAlpha = pass === 0 ? 0.22 : 0.9;
      for (let i = 0; i < this.lights.length - 1; i++) {
        const [r, g, b] = color(i / (this.lights.length - 1));
        if (!(r || g || b)) continue;
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(...this.lights[i]);
        ctx.lineTo(...this.lights[i + 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private build(
    width: number,
    height: number,
    dpr: number,
    top: number,
    bottom: number,
    angle: number,
  ) {
    const available = Math.max(64, bottom - top);
    this.scale = Math.min(width * 0.232, available / 2.75);
    const scale = this.scale;
    const centerX = width * 0.5;
    const centerY = (top + bottom) * 0.5 + scale * 0.16;
    const yaw = angle;
    const pitch = 0.23;
    const project: Project = ([x, y, z]) => {
      const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
      const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
      const ry = y * Math.cos(pitch) + rz * Math.sin(pitch);
      const depth = 1 / (1 + rz * 0.12 - y * 0.04);
      return [centerX + rx * scale * depth, centerY - ry * scale * depth];
    };
    const path = (vertices: Vec3[]) => {
      const result = new Path2D();
      vertices.forEach((p, i) => {
        const [x, y] = project(p);
        if (i === 0) result.moveTo(x, y);
        else result.lineTo(x, y);
      });
      result.closePath();
      return result;
    };
    const context = (canvas: HTMLCanvasElement) => {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };
    const base = context(this.base),
      objects = context(this.objects);
    const polygon = (
      ctx: CanvasRenderingContext2D,
      vertices: Vec3[],
      fill: string | CanvasGradient,
      stroke?: string,
    ) => {
      const shape = path(vertices);
      ctx.fillStyle = fill;
      ctx.fill(shape);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.75;
        ctx.stroke(shape);
      }
      return shape;
    };
    const quad = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      z: number,
    ): Vec3[] => [
      [x1, y1, z],
      [x2, y1, z],
      [x2, y2, z],
      [x1, y2, z],
    ];
    const cuboid = (
      ctx: CanvasRenderingContext2D,
      a: Vec3,
      b: Vec3,
      colors: [string, string, string],
    ) => {
      const [x1, y1, z1] = a,
        [x2, y2, z2] = b;
      polygon(
        ctx,
        [
          [x1, y1, z1],
          [x2, y1, z1],
          [x2, y2, z1],
          [x1, y2, z1],
        ],
        colors[0],
      );
      polygon(
        ctx,
        [
          [x1, y2, z1],
          [x2, y2, z1],
          [x2, y2, z2],
          [x1, y2, z2],
        ],
        colors[1],
      );
      if (yaw < 0)
        polygon(
          ctx,
          [
            [x2, y1, z1],
            [x2, y1, z2],
            [x2, y2, z2],
            [x2, y2, z1],
          ],
          colors[2],
        );
      else
        polygon(
          ctx,
          [
            [x1, y1, z1],
            [x1, y1, z2],
            [x1, y2, z2],
            [x1, y2, z1],
          ],
          colors[2],
        );
    };
    // The surrounding room stays neutral: its only colour is reflected LED light.
    const wallGradient = base.createLinearGradient(
      0,
      centerY - scale * 1.5,
      0,
      centerY + scale,
    );
    wallGradient.addColorStop(0, "#14171b");
    wallGradient.addColorStop(0.58, "#1a1e23");
    wallGradient.addColorStop(1, "#14171b");
    this.wall = polygon(base, quad(-1.9, -0.86, 1.9, 1.37, 0.97), wallGradient);
    polygon(
      base,
      [
        [-1.9, -0.86, 0.97],
        [1.9, -0.86, 0.97],
        [1.9, -0.86, -0.85],
        [-1.9, -0.86, -0.85],
      ],
      "#101318",
    );
    // Fine seam provides scale without a full architectural grid.
    base.strokeStyle = "rgba(255,255,255,0.045)";
    base.lineWidth = 0.75;
    base.beginPath();
    base.moveTo(...project([-1.9, -0.86, 0.97]));
    base.lineTo(...project([1.9, -0.86, 0.97]));
    base.stroke();
    // Contact shadow below the desk.
    const shadowCenter = project([0, -0.85, 0.05]);
    base.save();
    base.translate(...shadowCenter);
    base.scale(1, 0.22);
    const shadow = base.createRadialGradient(0, 0, 0, 0, 0, scale * 1.45);
    shadow.addColorStop(0, "rgba(0,0,0,0.7)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    base.fillStyle = shadow;
    base.fillRect(-scale * 1.5, -scale * 1.5, scale * 3, scale * 3);
    base.restore();
    // Thin solid desk, two substantial rectangular legs.
    for (const x of [-1.18, 1.1]) {
      cuboid(
        base,
        [x, -0.85, -0.38],
        [x + 0.085, -0.14, 0.51],
        ["#14181c", "#293038", "#1c2228"],
      );
    }
    cuboid(
      base,
      [-1.42, -0.17, -0.56],
      [1.42, -0.1, 0.7],
      ["#20252a", "#30363b", "#252b30"],
    );
    this.desk = path([
      [-1.42, -0.1, -0.56],
      [1.42, -0.1, -0.56],
      [1.42, -0.1, 0.7],
      [-1.42, -0.1, 0.7],
    ]);
    base.save();
    base.clip(this.desk);
    // Quiet grain catches light and stops the surface looking like a flat UI card.
    base.lineWidth = 0.45;
    for (let i = 0; i < 38; i++) {
      const z = -0.56 + i * 0.034;
      base.strokeStyle = i % 3 ? "rgba(255,255,255,0.016)" : "rgba(0,0,0,0.04)";
      base.beginPath();
      base.moveTo(...project([-1.42, -0.1, z]));
      base.lineTo(...project([1.42, -0.1, z]));
      base.stroke();
    }
    base.restore();
    // A quiet workspace: mat, keyboard and mouse explain the real scale.
    polygon(
      objects,
      [
        [-0.82, -0.098, -0.43],
        [0.93, -0.098, -0.43],
        [0.93, -0.098, 0.08],
        [-0.82, -0.098, 0.08],
      ],
      "#191e23",
      "rgba(255,255,255,0.035)",
    );
    cuboid(
      objects,
      [-0.64, -0.095, -0.32],
      [0.33, -0.067, -0.035],
      ["#393f46", "#424950", "#2c333a"],
    );
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 13; col++) {
        const x = -0.614 + col * 0.071,
          z = -0.297 + row * 0.064;
        if (row === 0 && col > 3 && col < 9) continue;
        const keyWidth = row === 0 && col === 3 ? 0.42 : 0.055;
        polygon(
          objects,
          [
            [x, -0.064, z],
            [x + keyWidth, -0.064, z],
            [x + keyWidth, -0.064, z + 0.045],
            [x, -0.064, z + 0.045],
          ],
          "#242a30",
        );
      }
    cuboid(
      objects,
      [0.55, -0.094, -0.25],
      [0.7, -0.047, -0.04],
      ["#353d44", "#50585f", "#293139"],
    );
    // Monitor stand: restrained brushed graphite, with visible base and stem.
    cuboid(
      objects,
      [-0.28, -0.098, 0.17],
      [0.28, -0.074, 0.48],
      ["#414850", "#545c64", "#353d46"],
    );
    cuboid(
      objects,
      [-0.065, -0.074, 0.33],
      [0.065, 0.3, 0.41],
      ["#40474f", "#5b646c", "#303840"],
    );
    // The offset back casing gives the screen a genuine thickness.
    cuboid(
      objects,
      [-0.82, 0.19, 0.37],
      [0.82, 1.15, 0.44],
      ["#151a1e", "#414850", "#2a3138"],
    );
    const face = quad(-0.796, 0.216, 0.796, 1.127, 0.362);
    const screenGradient = objects.createLinearGradient(
      centerX - scale,
      centerY - scale,
      centerX + scale,
      centerY,
    );
    screenGradient.addColorStop(0, "#252d35");
    screenGradient.addColorStop(0.48, "#141b21");
    screenGradient.addColorStop(1, "#10151a");
    polygon(objects, face, screenGradient, "rgba(255,255,255,0.075)");
    const screenClip = path(face);
    objects.save();
    objects.clip(screenClip);
    polygon(
      objects,
      [
        [-0.9, 1.27, 0.36],
        [-0.5, 1.27, 0.36],
        [0.75, 0.1, 0.36],
        [0.18, 0.1, 0.36],
      ],
      "rgba(255,255,255,0.017)",
    );
    objects.restore();
    // Read LEDs clockwise around the diffuser. This is deliberately a visual
    // scenario and does not replace the controller's configured coordinates.
    const perimeter = (fraction: number, z: number, offset = 0): Vec3 => {
      const left = -0.831 - offset,
        right = 0.831 + offset,
        low = 0.182 - offset,
        high = 1.16 + offset;
      const w = right - left,
        h = high - low,
        distance = fraction * 2 * (w + h);
      if (distance < w) return [left + distance, high, z];
      if (distance < w + h) return [right, high - (distance - w), z];
      if (distance < w * 2 + h) return [right - (distance - w - h), low, z];
      return [left, low + (distance - w * 2 - h), z];
    };
    this.lights = Array.from({ length: 81 }, (_, i) =>
      project(perimeter(i / 80, 0.37)),
    );
    this.wallLights = Array.from({ length: 14 }, (_, i) =>
      project(perimeter(i / 14, 0.965, 0.07)),
    );
    this.deskLights = Array.from({ length: 6 }, (_, i) =>
      project([-0.9 + i * 0.36, -0.099, 0.5]),
    );
  }
}
