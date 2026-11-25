import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { Layout } from '../geometry/layout';

/**
 * 3D-сцена. Вся геометрия ролика и лезвий строится в «плоских» координатах
 * (x — прокатка, y — ось ролика, s — расстояние от режущей кромки внутрь)
 * и затем изгибается функцией bend(k): k = 0 — всё лежит плоско (как
 * вырубка-штамп), k = 1 — свёрнуто в ролик радиуса rTip. Так анимация
 * «развернуть ↔ свернуть» показывает, как плоский контур превращается в нож.
 */

interface Bendable {
  geom: THREE.BufferGeometry;
  /** плоские координаты: x, y, s для каждой вершины */
  flat: Float32Array;
}

const COLORS = {
  bg: 0x16130f,
  table: 0x221d17,
  dough: 0xe8c98e,
  roller: 0xe9e1cf,
  steel: 0xd9dde3,
  wood: 0x9a6a3c,
  cutFaint: 0x7a5427,
  cutLive: 0xff8a3d,
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;

  private pivot = new THREE.Group(); // перемещение при прокатке
  private rotor = new THREE.Group(); // вращение вокруг оси ролика
  private bentRoot = new THREE.Group(); // смещение, чтобы ось вращения была в центре
  private solidParts = new THREE.Group(); // торцы, ось, ручка (только в свёрнутом виде)
  private handle = new THREE.Group();
  private doughGroup = new THREE.Group();

  private bendables: Bendable[] = [];
  private clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -1e9);

  private layout: Layout | null = null;
  private k = 1;
  private travel = 0;
  private lift = 0;
  private anim: ((dt: number) => boolean) | null = null;
  private onBendChange: (k: number) => void = () => {};

  private mats = {
    roller: new THREE.MeshStandardMaterial({ color: COLORS.roller, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.22, metalness: 1, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.6 }),
    dough: new THREE.MeshStandardMaterial({ color: COLORS.dough, roughness: 0.9 }),
    cutFaint: new THREE.LineBasicMaterial({ color: COLORS.cutFaint, transparent: true, opacity: 0.55 }),
    cutLive: new THREE.LineBasicMaterial({ color: COLORS.cutLive }),
  };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(COLORS.bg);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;

    this.camera = new THREE.PerspectiveCamera(38, 1, 2, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    const sun = (this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2));
    sun.position.set(600, 1400, 900);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2016, 0.6));

    const table = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 1 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -2.5;
    table.receiveShadow = true;
    this.scene.add(table);

    this.mats.cutLive.clippingPlanes = [this.clip];

    this.bentRoot.add(this.solidParts);
    this.rotor.add(this.bentRoot);
    this.pivot.add(this.rotor, this.handle);
    this.scene.add(this.pivot, this.doughGroup);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.anim && !this.anim(dt)) this.anim = null;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  onBend(cb: (k: number) => void) {
    this.onBendChange = cb;
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------- построение ------------------------- */

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      if (c === this.solidParts) continue;
      g.remove(c);
      c.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
  }

  setLayout(layout: Layout, refit = false) {
    const first = !this.layout;
    this.layout = layout;
    this.anim = null;
    this.travel = 0;
    this.lift = 0;
    this.clip.constant = -1e9;
    this.bendables = [];
    this.clearGroup(this.bentRoot);
    this.clearGroup(this.solidParts);
    this.clearGroup(this.handle);
    this.clearGroup(this.doughGroup);

    const { params, contour, centers, circTip, cylLength, rTip, rSurface } = layout;
    const H = params.bladeHeight + params.embed;
    const d = params.bladeHeight;

    // --- поверхность ролика (изгибаемый лист на уровне s = d) ---
    {
      const nx = 384, ny = 4;
      const geom = new THREE.BufferGeometry();
      const flat = new Float32Array((nx + 1) * (ny + 1) * 3);
      const idx: number[] = [];
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const v = (j * (nx + 1) + i) * 3;
          flat[v] = -circTip / 2 + (circTip * i) / nx;
          flat[v + 1] = -cylLength / 2 + (cylLength * j) / ny;
          flat[v + 2] = d;
          if (i < nx && j < ny) {
            const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
            idx.push(a, c, b, b, c, e);
          }
        }
      geom.setIndex(idx);
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat.length), 3));
      const mesh = new THREE.Mesh(geom, this.mats.roller);
      mesh.castShadow = mesh.receiveShadow = true;
      this.bentRoot.add(mesh);
      this.bendables.push({ geom, flat });
    }

    // --- лезвия ---
    const t = Math.max(0.6, params.thickness);
    const bev = Math.min(2.5, H * 0.3);
    const profile: [number, number][] = [
      [0.1 * t, 0], [t / 2, bev], [t / 2, H + 0.5], [-t / 2, H + 0.5], [-t / 2, bev], [-0.1 * t, 0],
    ];
    const pts = contour.points;
    const n = pts.length;
    for (const cx of centers) {
      const S = profile.length; // число полос
      const flat = new Float32Array(n * S * 2 * 3);
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i], pp = pts[(i - 1 + n) % n], pn = pts[(i + 1) % n];
        let tx = pn[0] - pp[0], ty = pn[1] - pp[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const nxv = ty, nyv = -tx; // внешняя нормаль (обход CCW)
        for (let sIdx = 0; sIdx < S; sIdx++) {
          const ends = [profile[sIdx], profile[(sIdx + 1) % S]];
          for (let e = 0; e < 2; e++) {
            const [o, s] = ends[e];
            const v = ((i * S + sIdx) * 2 + e) * 3;
            flat[v] = cx + p[0] + o * nxv;
            flat[v + 1] = p[1] + o * nyv;
            flat[v + 2] = s;
          }
          const a = (i * S + sIdx) * 2, b = (((i + 1) % n) * S + sIdx) * 2;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setIndex(idx);
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat.length), 3));
      const mesh = new THREE.Mesh(geom, this.mats.steel);
      mesh.castShadow = true;
      this.bentRoot.add(mesh);
      this.bendables.push({ geom, flat });
    }

    // --- торцы, ось, ручка (показываются только когда ролик свёрнут) ---
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(rSurface, 128), this.mats.roller);
      cap.position.set(0, rTip, (side * cylLength) / 2);
      cap.rotation.y = side > 0 ? 0 : Math.PI;
      cap.castShadow = true;
      this.solidParts.add(cap);
    }
    const axleR = Math.max(6, rSurface * 0.12);
    const axleLen = cylLength + 70;
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(axleR, axleR, axleLen, 48), this.mats.steel);
    axle.rotation.x = Math.PI / 2;
    axle.position.set(0, rTip, 0);
    this.solidParts.add(axle);

    const reach = Math.max(180, rTip * 1.9);
    const armEnd = new THREE.Vector3(-reach * 0.55, rTip + reach * 0.85, 0);
    const forkZ = axleLen / 2 - 8;
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(0, rTip, side * forkZ);
      const to = armEnd.clone().setZ(side * (forkZ * 0.55));
      const len = from.distanceTo(to);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(axleR * 0.75, axleR * 0.75, len, 24), this.mats.steel);
      arm.position.copy(from).add(to).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      arm.castShadow = true;
      this.handle.add(arm);
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(axleR * 1.6, axleR * 1.6, forkZ * 1.1 + 40, 40), this.mats.wood);
    grip.rotation.x = Math.PI / 2;
    grip.position.copy(armEnd);
    grip.castShadow = true;
    this.handle.add(grip);

    // --- тесто и линии реза ---
    const doughLen = circTip + layout.pitch * 0.5;
    const doughW = cylLength + 60;
    const dough = new THREE.Mesh(new THREE.BoxGeometry(doughLen, 2.5, doughW), this.mats.dough);
    dough.position.y = -1.25;
    dough.receiveShadow = true;
    this.doughGroup.add(dough);
    for (const cx of centers) {
      const linePts = pts.map(([x, y]) => new THREE.Vector3(cx + x, 0.35, y));
      const g = new THREE.BufferGeometry().setFromPoints(linePts);
      this.doughGroup.add(new THREE.LineLoop(g, this.mats.cutFaint));
      const g2 = new THREE.BufferGeometry().setFromPoints(linePts.map((v) => v.clone().setY(0.5)));
      this.doughGroup.add(new THREE.LineLoop(g2, this.mats.cutLive));
    }

    // тени под размер сцены
    const sun = this.sun;
    const ext = Math.max(doughLen, doughW, reach * 2) * 0.8;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 6000 });
    sun.shadow.camera.updateProjectionMatrix();

    this.rotor.position.set(0, rTip, 0);
    this.bentRoot.position.set(0, -rTip, 0);
    this.applyBend();
    this.applyMotion();
    if (first || refit) this.fitView();
  }

  /* ------------------------- изгиб ------------------------- */

  private applyBend() {
    if (!this.layout) return;
    const rTip = this.layout.rTip;
    const k = this.k;
    const kappa = k / rTip;
    for (const { geom, flat } of this.bendables) {
      const pos = geom.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let v = 0; v < flat.length; v += 3) {
        const x = flat[v], y = flat[v + 1], s = flat[v + 2];
        if (kappa < 1e-7) {
          arr[v] = x; arr[v + 1] = s; arr[v + 2] = y;
        } else {
          const rho = 1 / kappa;
          const phi = x * kappa;
          const sh = Math.sin(phi / 2);
          arr[v] = (rho - s) * Math.sin(phi);
          arr[v + 1] = 2 * rho * sh * sh + s * Math.cos(phi);
          arr[v + 2] = y;
        }
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
      geom.computeBoundingSphere();
    }
    const closed = k > 0.999;
    this.solidParts.visible = closed;
    this.handle.visible = closed;
  }

  setBend(k: number) {
    this.anim = null;
    this.k = Math.min(1, Math.max(0, k));
    if (this.k < 1) {
      this.travel = 0;
      this.lift = 0;
      this.clip.constant = -1e9;
    }
    this.applyBend();
    this.applyMotion();
  }

  private applyMotion() {
    if (!this.layout) return;
    this.pivot.position.set(this.travel, this.lift, 0);
    this.rotor.rotation.z = -this.travel / this.layout.rTip;
  }

  /* ------------------------- анимации ------------------------- */

  /** Свернуть ролик и прокатить его по тесту на один оборот. */
  roll() {
    const L = this.layout;
    if (!L) return;
    const start = -L.circTip / 2, end = L.circTip / 2;
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const phases: { dur: number; step: (u: number) => void }[] = [];
    const k0 = this.k;
    if (k0 < 1) {
      phases.push({
        dur: 0.9,
        step: (u) => {
          this.k = k0 + (1 - k0) * ease(u);
          this.applyBend();
          this.onBendChange(this.k);
        },
      });
    }
    const t0 = this.travel;
    phases.push({
      dur: 0.8,
      step: (u) => {
        this.clip.constant = -1e9;
        this.travel = t0 + (start - t0) * ease(u);
        this.lift = Math.sin(Math.PI * u) * Math.min(60, L.rTip * 0.5);
        this.applyMotion();
      },
    });
    phases.push({
      dur: Math.max(3, L.circTip / 220),
      step: (u) => {
        this.lift = 0;
        this.travel = start + (end - start) * u;
        this.clip.constant = this.travel;
        this.applyMotion();
      },
    });
    let pi = 0, time = 0;
    this.anim = (dt) => {
      const ph = phases[pi];
      time += dt;
      const u = Math.min(1, time / ph.dur);
      ph.step(u);
      if (u >= 1) {
        pi++;
        time = 0;
      }
      return pi < phases.length;
    };
  }

  /** STL свёрнутого ролика с лезвиями (для 3D-печати или проверки в CAD). */
  exportStl(): ArrayBuffer | null {
    const L = this.layout;
    if (!L) return null;
    const keep = this.k;
    this.k = 1;
    this.applyBend();
    const group = new THREE.Group();
    // лезвия (bendables[0] — поверхность ролика, её заменяем сплошным цилиндром)
    for (const b of this.bendables.slice(1)) group.add(new THREE.Mesh(b.geom.clone()));
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(L.rSurface, L.rSurface, L.cylLength, 256));
    roller.rotation.x = Math.PI / 2;
    roller.position.set(0, L.rTip, 0);
    group.add(roller);
    group.updateMatrixWorld(true);
    const data = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
    this.k = keep;
    this.applyBend();
    return data.buffer as ArrayBuffer;
  }

  fitView() {
    const L = this.layout;
    if (!L) return;
    const size = Math.max(L.circTip * 0.75, L.cylLength * 1.1, L.rTip * 5);
    this.controls.target.set(0, L.rTip * 0.8, 0);
    this.camera.position.set(size * 1.05, size * 0.95, size * 1.55);
    this.controls.update();
  }
}
