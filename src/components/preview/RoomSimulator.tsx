import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { LightRuntime } from "../../runtime/runtime";

const initialYaw = 0.28;

function textureScreen() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
  const background = ctx.createLinearGradient(0, 0, 640, 384);
  background.addColorStop(0, "#27313b");
  background.addColorStop(0.45, "#10161c");
  background.addColorStop(1, "#080c10");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 640, 384);
  const reflection = ctx.createLinearGradient(130, 0, 430, 384);
  reflection.addColorStop(0, "rgba(210,220,230,0)");
  reflection.addColorStop(0.42, "rgba(210,220,230,.035)");
  reflection.addColorStop(0.48, "rgba(210,220,230,.015)");
  reflection.addColorStop(1, "rgba(210,220,230,0)");
  ctx.fillStyle = reflection;
  ctx.fillRect(0, 0, 640, 384);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function textureWood() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#665e53";
  ctx.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y++) {
    const shade = Math.round(
      86 + Math.sin(y * 0.74) * 4 + Math.sin(y * 0.117) * 5,
    );
    ctx.strokeStyle = `rgba(${shade + 11},${shade + 4},${shade - 6},.28)`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      160,
      y + Math.sin(y * 0.07) * 2,
      340,
      y + Math.cos(y * 0.09) * 2,
      512,
      y,
    );
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function featherSurface(
  material: THREE.MeshStandardMaterial,
  kind: "wall" | "floor",
) {
  // Fade only the distant architectural surfaces into the studio background.
  // Object geometry, shadows and local coloured light remain depth tested.
  material.transparent = true;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 studioPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nstudioPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
    shader.fragmentShader =
      "varying vec3 studioPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      float studioFade = ${
        kind === "wall"
          ? "(1.0-smoothstep(0.8,2.5,abs(studioPosition.x))) * (1.0-smoothstep(1.9,2.75,studioPosition.y)) * smoothstep(0.0,0.18,studioPosition.y)"
          : "1.0-smoothstep(0.65,2.15,length(studioPosition.xz-vec2(0.0,0.25)))"
      };
      diffuseColor.a *= studioFade;
      #include <opaque_fragment>
    `,
    );
  };
  material.customProgramCacheKey = () => `studio-${kind}`;
}

export function RoomSimulator({
  runtime,
  fallback,
}: {
  runtime: LightRuntime;
  fallback: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    yaw = useRef(initialYaw),
    drag = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (failed) return;
    const canvas = canvasRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setClearColor(0x080a0d, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const scene = new THREE.Scene();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmrem.fromScene(environment, 0.04);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.32;
    environment.dispose();
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    const trackMaterial = <T extends THREE.Material>(material: T) => {
      materials.add(material);
      return material;
    };
    const surface = (color: number, roughness = 0.6, metalness = 0) =>
      trackMaterial(
        new THREE.MeshStandardMaterial({ color, roughness, metalness }),
      );
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
    ) => {
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    const rounded = (
      size: [number, number, number],
      radius: number,
      material: THREE.Material,
      position: [number, number, number],
    ) => add(new RoundedBoxGeometry(...size, 3, radius), material, position);
    scene.add(new THREE.HemisphereLight(0xdfe7ee, 0x262321, 1.8));
    const key = new THREE.DirectionalLight(0xfff5e9, 2.2);
    key.position.set(-2.3, 4.7, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 2.5;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 22;
    key.shadow.blurSamples = 12;
    key.target.position.set(0, 0.8, 0);
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xd8e4f2, 0.55);
    fill.position.set(3, 2, 1);
    scene.add(fill);
    const wallMaterial = surface(0x292b2e, 0.95);
    featherSurface(wallMaterial, "wall");
    const wall = add(
      new THREE.PlaneGeometry(8, 5),
      wallMaterial,
      [0, 2.5, -0.33],
    );
    wall.castShadow = false;
    const floorMaterial = surface(0x14171b, 0.91);
    featherSurface(floorMaterial, "floor");
    const floor = add(new THREE.PlaneGeometry(8, 8), floorMaterial, [0, 0, 0]);
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    const wood = textureWood();
    textures.add(wood);
    const deskMaterial = trackMaterial(
      new THREE.MeshStandardMaterial({
        map: wood,
        color: 0xa9a39b,
        roughness: 0.58,
        metalness: 0.04,
      }),
    );
    rounded([1.94, 0.047, 0.9], 0.022, deskMaterial, [0, 0.76, 0.25]);
    const metal = surface(0x22272c, 0.34, 0.6);
    for (const x of [-0.79, 0.79]) {
      rounded([0.035, 0.72, 0.035], 0.008, metal, [x, 0.365, -0.08]);
      rounded([0.035, 0.72, 0.035], 0.008, metal, [x, 0.365, 0.58]);
      rounded([0.042, 0.025, 0.72], 0.008, metal, [x, 0.025, 0.25]);
      rounded([0.035, 0.032, 0.7], 0.008, metal, [x, 0.716, 0.25]);
    }
    const mat = surface(0x24292d, 0.94);
    rounded([1.21, 0.004, 0.39], 0.025, mat, [0.015, 0.786, 0.415]);
    const aluminum = surface(0x6c7072, 0.3, 0.68);
    rounded([0.3, 0.013, 0.2], 0.024, aluminum, [0, 0.795, 0.013]);
    rounded([0.065, 0.235, 0.035], 0.012, aluminum, [0, 0.917, -0.025]);
    const casing = surface(0x292e32, 0.3, 0.58);
    rounded([1.27, 0.763, 0.048], 0.018, casing, [0, 1.31, -0.007]);
    const screenTexture = textureScreen();
    textures.add(screenTexture);
    const screenMaterial = trackMaterial(
      new THREE.MeshPhysicalMaterial({
        map: screenTexture,
        color: 0xc6cbd1,
        roughness: 0.18,
        metalness: 0.2,
        clearcoat: 0.9,
        clearcoatRoughness: 0.16,
        envMapIntensity: 2.4,
      }),
    );
    rounded([1.228, 0.713, 0.007], 0.011, screenMaterial, [0, 1.321, 0.02]);
    // The lower bezel catches a narrow highlight without any logos or fake UI.
    rounded(
      [0.09, 0.003, 0.003],
      0.001,
      surface(0x555e66, 0.4, 0.6),
      [0, 0.946, 0.019],
    );
    const keyboardBase = surface(0x8a8c8e, 0.4, 0.4);
    rounded([0.643, 0.018, 0.224], 0.013, keyboardBase, [-0.16, 0.8, 0.405]);
    const keyGeometry = new RoundedBoxGeometry(0.037, 0.011, 0.033, 2, 0.004);
    geometries.add(keyGeometry);
    const keysMaterial = surface(0x42464a, 0.65, 0.05);
    const positions: Array<[number, number, number]> = [];
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 14; col++) {
        if (row === 4 && col >= 3 && col <= 9) continue;
        positions.push([-0.45 + col * 0.044, 0.816, 0.326 + row * 0.039]);
      }
    const keys = new THREE.InstancedMesh(
      keyGeometry,
      keysMaterial,
      positions.length,
    );
    const matrix = new THREE.Matrix4();
    positions.forEach((position, i) => {
      matrix.makeTranslation(...position);
      keys.setMatrixAt(i, matrix);
    });
    keys.castShadow = true;
    keys.receiveShadow = true;
    scene.add(keys);
    rounded([0.297, 0.011, 0.033], 0.004, keysMaterial, [-0.164, 0.816, 0.482]);
    const mouse = add(
      new THREE.SphereGeometry(1, 24, 12),
      surface(0xb4b4b0, 0.45, 0.1),
      [0.37, 0.8, 0.417],
    );
    mouse.scale.set(0.041, 0.022, 0.067);
    const wheel = add(
      new THREE.CylinderGeometry(0.005, 0.005, 0.015, 12),
      surface(0x303338, 0.5),
      [0.37, 0.82, 0.393],
    );
    wheel.rotation.z = Math.PI / 2;
    // Six narrow, one-sided area sources emit toward the wall from behind the
    // monitor. Their geometry cannot illuminate the front through the display.
    RectAreaLightUniformsLib.init();
    const emitters: [number, number, number, number, number][] = [
      [-0.43, 1.665, 0.39, 0.012, 0.05],
      [0, 1.665, 0.39, 0.012, 0.15],
      [0.43, 1.665, 0.39, 0.012, 0.25],
      [0.6, 1.31, 0.012, 0.63, 0.4],
      [0, 0.957, 1.18, 0.012, 0.65],
      [-0.6, 1.31, 0.012, 0.63, 0.9],
    ];
    const lights = emitters.map(([x, y, w, h]) => {
      const light = new THREE.RectAreaLight(0xffffff, 0, w, h);
      light.position.set(x, y, -0.043);
      light.lookAt(x, y, -1);
      scene.add(light);
      return light;
    });
    // The physical diffuser sits on the back, inset from the casing. Depth
    // testing hides it from a frontal view, as a real backlight would be.
    const strips = emitters.map(([x, y, w, h]) => {
      const material = trackMaterial(
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      return rounded([w, h, 0.006], 0.003, material, [x, y, -0.038]);
    });
    const color = new THREE.Color();
    const updateLight = () => {
      const frame = runtime.frame,
        count = Math.floor(frame.length / 3);
      for (let j = 0; j < lights.length; j++) {
        let r = 0,
          g = 0,
          b = 0;
        const fraction = emitters[j][4];
        for (let n = -2; n <= 2; n++) {
          const i =
            Math.max(
              0,
              Math.min(count - 1, Math.floor((fraction + n * 0.015) * count)),
            ) * 3;
          r += frame[i] || 0;
          g += frame[i + 1] || 0;
          b += frame[i + 2] || 0;
        }
        color.setRGB(r / 1275, g / 1275, b / 1275, THREE.SRGBColorSpace);
        lights[j].color.copy(color);
        lights[j].intensity = 2400;
        (strips[j].material as THREE.MeshBasicMaterial).color.copy(color);
      }
    };
    let width = 1,
      height = 1,
      stageTop = 0,
      stageBottom = 1,
      cameraYaw = NaN;
    const main = canvas.closest(".light-space"),
      heading = main?.querySelector(".scene-heading"),
      caption = main?.querySelector(".preview-caption"),
      dock = main?.querySelector(".light-dock");
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      stageTop = heading
        ? heading.getBoundingClientRect().bottom - rect.top + 8
        : height * 0.2;
      stageBottom = caption
        ? caption.getBoundingClientRect().top - rect.top - 8
        : dock
          ? dock.getBoundingClientRect().top - rect.top - 12
          : height * 0.8;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.setViewOffset(
        width,
        height,
        0,
        height * 0.5 - (stageTop + stageBottom) * 0.5,
        width,
        height,
      );
      camera.updateProjectionMatrix();
      cameraYaw = NaN;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    if (heading) observer.observe(heading);
    if (caption) observer.observe(caption);
    if (dock) observer.observe(dock);
    measure();
    let raf = 0,
      disposed = false;
    const lost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", lost);
    const render = () => {
      if (disposed) return;
      const viewHeight = Math.max(1, stageBottom - stageTop);
      if (cameraYaw !== yaw.current) {
        cameraYaw = yaw.current;
        const distance = Math.max(
          (3.15 * height) / viewHeight,
          (3.8 * height) / width,
        );
        camera.position.set(
          Math.sin(cameraYaw) * distance,
          1.23 + distance * 0.27,
          Math.cos(cameraYaw) * distance,
        );
        camera.lookAt(0, 0.91, 0.12);
      }
      updateLight();
      renderer.setViewport(0, 0, width, height);
      renderer.clear();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      key.shadow.map?.dispose();
      key.shadow.mapPass?.dispose();
      environmentTarget.dispose();
      renderer.dispose();
    };
  }, [runtime, failed]);
  if (failed) return fallback;
  return (
    <section
      className="simulator immersive-simulator"
      aria-label="Виртуальная LED-инсталляция"
      data-preview-renderer="webgl"
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`Пример подсветки за монитором, ${runtime.scene.count} светодиодов. Потяните или используйте стрелки влево и вправо, чтобы повернуть. Home — исходный ракурс.`}
        onKeyDown={(event) => {
          if (event.key === "Home") {
            event.preventDefault();
            yaw.current = initialYaw;
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            yaw.current = Math.max(
              -0.65,
              Math.min(
                0.65,
                yaw.current + (event.key === "ArrowLeft" ? -0.08 : 0.08),
              ),
            );
          }
        }}
        onPointerDown={(event) => {
          drag.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current !== null) {
            yaw.current = Math.max(
              -0.65,
              Math.min(
                0.65,
                yaw.current + (event.clientX - drag.current) * 0.004,
              ),
            );
            drag.current = event.clientX;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      />
    </section>
  );
}
