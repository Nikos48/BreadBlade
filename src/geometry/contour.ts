import type { Params } from '../params';

export type V2 = [number, number];

/** Сколько отрезков в одной четверти контура (весь контур = 4·Q). */
export const QUARTER_SEGMENTS = 240;

/**
 * Замкнутый контур лаваша. Симметричен относительно обеих осей.
 * points[0] = (+a, 0); points[Q] = (0, +b); points[2Q] = (−a, 0); points[3Q] = (0, −b).
 * Обход — против часовой стрелки, последняя точка ≠ первой (замыкание подразумевается).
 */
export interface Contour {
  points: V2[];
  quarter: number;
  /** Фактические полуразмеры (с учётом выхода сплайна за габарит) */
  halfX: number;
  halfY: number;
  perimeter: number;
  area: number;
}

/* ---------- генераторы первой четверти: от (a,0) до (0,b) ---------- */

function quarterOval(a: number, b: number, n: number): V2[] {
  const N = 1500;
  const out: V2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * (Math.PI / 2);
    const c = Math.cos(t), s = Math.sin(t);
    // полярная форма суперэллипса — равномерная плотность точек по углу
    const r = Math.pow(Math.pow(Math.abs(c) / a, n) + Math.pow(Math.abs(s) / b, n), -1 / n);
    out.push([r * c, r * s]);
  }
  out[0] = [a, 0];
  out[N] = [0, b];
  return out;
}

function quarterRoundRect(a: number, b: number, rIn: number): V2[] {
  const r = Math.max(0.5, Math.min(rIn, a - 0.01, b - 0.01));
  const out: V2[] = [[a, 0], [a, b - r]];
  const N = 400;
  for (let i = 1; i < N; i++) {
    const t = (i / N) * (Math.PI / 2);
    out.push([a - r + r * Math.cos(t), b - r + r * Math.sin(t)]);
  }
  out.push([a - r, b], [0, b]);
  return out;
}

/** Центростремительный Catmull–Rom через точки, с зеркальными соседями на осях (гладкая симметрия). */
function quarterCustom(a: number, b: number, pts: [number, number][]): V2[] {
  const inner: V2[] = pts.map(([u, v]) => [u * a, v * b]);
  // упорядочим по углу, чтобы контур не перекручивался
  inner.sort((p, q) => Math.atan2(p[1] / b, p[0] / a) - Math.atan2(q[1] / b, q[0] / a));
  const first = inner[0] ?? [a * 0.7, b * 0.7];
  const last = inner[inner.length - 1] ?? first;
  const ctrl: V2[] = [[first[0], -first[1]], [a, 0], ...inner, [0, b], [-last[0], last[1]]];

  const out: V2[] = [];
  const SEG = 200;
  for (let i = 1; i < ctrl.length - 2; i++) {
    const p0 = ctrl[i - 1], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[i + 2];
    const td = (p: V2, q: V2) => Math.max(1e-6, Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1])));
    const t0 = 0, t1 = t0 + td(p0, p1), t2 = t1 + td(p1, p2), t3 = t2 + td(p2, p3);
    for (let k = i === 1 ? 0 : 1; k <= SEG; k++) {
      const t = t1 + ((t2 - t1) * k) / SEG;
      const lerp = (P: V2, Q: V2, ta: number, tb: number): V2 => {
        const w = (t - ta) / (tb - ta);
        return [P[0] + (Q[0] - P[0]) * w, P[1] + (Q[1] - P[1]) * w];
      };
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  return out;
}

/* ---------- утилиты ---------- */

function polylineLength(p: V2[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}

/** Равномерная (по длине дуги) пересэмплировка открытой ломаной в `segments` отрезков. */
export function resample(p: V2[], segments: number): V2[] {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const L = cum[cum.length - 1];
  const out: V2[] = [];
  let j = 0;
  for (let k = 0; k <= segments; k++) {
    const s = (L * k) / segments;
    while (j < p.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const w = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push([p[j][0] + (p[j + 1][0] - p[j][0]) * w, p[j][1] + (p[j + 1][1] - p[j][1]) * w]);
  }
  out[0] = p[0];
  out[segments] = p[p.length - 1];
  return out;
}

export function buildContour(params: Params): Contour {
  const a = params.length / 2;
  const b = params.width / 2;
  let q: V2[];
  switch (params.shape) {
    case 'rect':
      q = quarterRoundRect(a, b, params.cornerRadius);
      break;
    case 'custom':
      q = quarterCustom(a, b, params.customPoints);
      break;
    default:
      q = quarterOval(a, b, Math.max(1.2, params.squareness));
  }
  const Q = QUARTER_SEGMENTS;
  const r = resample(q, Q); // r[0]=(a,0) … r[Q]=(0,b)

  const pts: V2[] = [];
  for (let i = 0; i < Q; i++) pts.push([r[i][0], r[i][1]]); // I четверть
  for (let i = Q; i > 0; i--) pts.push([-r[i][0], r[i][1]]); // II
  for (let i = 0; i < Q; i++) pts.push([-r[i][0], -r[i][1]]); // III
  for (let i = Q; i > 0; i--) pts.push([r[i][0], -r[i][1]]); // IV

  let halfX = 0, halfY = 0, area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = pts[(i + 1) % pts.length];
    halfX = Math.max(halfX, Math.abs(p[0]));
    halfY = Math.max(halfY, Math.abs(p[1]));
    area += p[0] * n[1] - n[0] * p[1];
  }
  return {
    points: pts,
    quarter: Q,
    halfX,
    halfY,
    perimeter: 4 * polylineLength(r),
    area: Math.abs(area) / 2,
  };
}

/** Минимальный радиус кривизны контура (для проверки гибки стали). */
export function minCurvatureRadius(c: Contour): number {
  const p = c.points;
  let best = Infinity;
  const n = p.length;
  const step = 2;
  for (let i = 0; i < n; i++) {
    const A = p[(i - step + n) % n], B = p[i], C = p[(i + step) % n];
    const ab = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const bc = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const ca = Math.hypot(A[0] - C[0], A[1] - C[1]);
    const cross = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]));
    if (cross < 1e-9) continue;
    best = Math.min(best, (ab * bc * ca) / (2 * cross));
  }
  return best;
}
