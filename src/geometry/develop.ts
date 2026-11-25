import type { Contour, V2 } from './contour';

/**
 * Развёртка лезвия.
 *
 * Лезвие — полоса стали, стоящая на ролике радиально: от дна паза (r = rRoot)
 * до режущей кромки (r = rTip) вдоль кривой — образа контура лаваша на цилиндре.
 * Такая линейчатая поверхность в общем случае неразвёртываема, поэтому
 * разворачиваем её как полосу треугольников с сохранением длин всех рёбер:
 * длина кромки, длина нижнего края и высота полосы в каждой точке совпадают
 * с 3D-формой. Остаточное кручение полосы сталь берёт на себя при монтаже.
 */

export interface DevMark {
  /** точка на нижней кромке */
  a: V2;
  /** точка на линии поверхности ролика */
  b: V2;
  label: string;
}

export interface DevPart {
  /** режущая кромка */
  outer: V2[];
  /** нижний край (дно паза) */
  inner: V2[];
  /** линия поверхности ролика (граница заглубления) */
  surface: V2[];
  marks: DevMark[];
  width: number;
  height: number;
}

export interface Development {
  parts: DevPart[];
  /** длины (суммарно по всем частям), мм */
  tipLength: number;
  rootLength: number;
  surfaceLength: number;
  stripHeight: number;
  overlaps: boolean;
}

function place(P: V2, Q: V2, dP: number, dQ: number): V2 {
  const ux = Q[0] - P[0], uy = Q[1] - P[1];
  const d = Math.hypot(ux, uy) || 1e-9;
  const a = (dP * dP - dQ * dQ + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, dP * dP - a * a));
  const ex = ux / d, ey = uy / d;
  // справа от направления P→Q
  return [P[0] + a * ex + h * ey, P[1] + a * ey - h * ex];
}

const d3 = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

function segmentsIntersect(p1: V2, p2: V2, p3: V2, p4: V2): boolean {
  const d = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3_ = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3_ * d4 < 0;
}

function polygonSelfIntersects(poly: V2[]): boolean {
  const step = Math.max(1, Math.floor(poly.length / 400));
  const p: V2[] = [];
  for (let i = 0; i < poly.length; i += step) p.push(poly[i]);
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a1 = p[i], a2 = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(a1, a2, p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Поворот к минимальному габариту, «лёжа», в положительный квадрант. */
function normalize(part: DevPart): DevPart {
  const all = [...part.outer, ...part.inner];
  let best = { area: Infinity, ang: 0 };
  for (let k = 0; k < 360; k++) {
    const ang = (k / 360) * Math.PI;
    const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of all) {
      const X = x * c - y * s, Y = x * s + y * c;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (area < best.area - 1e-6) best = { area, ang: (x1 - x0) >= (y1 - y0) ? ang : ang + Math.PI / 2 };
  }
  const c = Math.cos(best.ang), s = Math.sin(best.ang);
  const rot = ([x, y]: V2): V2 => [x * c - y * s, x * s + y * c];
  const outer = part.outer.map(rot), inner = part.inner.map(rot), surface = part.surface.map(rot);
  const marks = part.marks.map((m) => ({ ...m, a: rot(m.a), b: rot(m.b) }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [...outer, ...inner]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  // кромку — наверх (по среднему y), чтобы чертёж читался одинаково
  const avg = (pts: V2[]) => pts.reduce((acc, p) => acc + p[1], 0) / pts.length;
  const flip = avg(outer) < avg(inner);
  const tr = ([x, y]: V2): V2 => [x - x0, flip ? y1 - y : y - y0];
  return {
    outer: outer.map(tr),
    inner: inner.map(tr),
    surface: surface.map(tr),
    marks: marks.map((m) => ({ ...m, a: tr(m.a), b: tr(m.b) })),
    width: x1 - x0,
    height: y1 - y0,
  };
}

export function developBlade(contour: Contour, rTip: number, rRoot: number, rSurface: number, split: number): Development {
  const pts = contour.points;
  const n = pts.length;
  const Q = contour.quarter;
  const markStep = Q / 2; // метка каждые 1/8 контура
  const per = n / split;
  const frac = (rSurface - rRoot) / (rTip - rRoot);

  const at = (i: number, r: number) => {
    const [x, y] = pts[((i % n) + n) % n];
    const phi = x / rTip;
    return [r * Math.sin(phi), -r * Math.cos(phi), y];
  };

  let tipLength = 0, rootLength = 0, surfaceLength = 0;
  const parts: DevPart[] = [];
  let overlaps = false;

  for (let p = 0; p < split; p++) {
    const i0 = p * per;
    const A3: number[][] = [], B3: number[][] = [];
    for (let k = 0; k <= per; k++) {
      A3.push(at(i0 + k, rRoot));
      B3.push(at(i0 + k, rTip));
    }
    const A: V2[] = [[0, 0]];
    const B: V2[] = [[0, d3(A3[0], B3[0])]];
    for (let k = 0; k < per; k++) {
      const a1 = place(A[k], B[k], d3(A3[k], A3[k + 1]), d3(B3[k], A3[k + 1]));
      A.push(a1);
      B.push(place(a1, B[k], d3(A3[k + 1], B3[k + 1]), d3(B3[k], B3[k + 1])));
      tipLength += d3(B3[k], B3[k + 1]);
      rootLength += d3(A3[k], A3[k + 1]);
    }
    const surface: V2[] = A.map((a, k) => [a[0] + (B[k][0] - a[0]) * frac, a[1] + (B[k][1] - a[1]) * frac]);
    for (let k = 1; k < surface.length; k++)
      surfaceLength += Math.hypot(surface[k][0] - surface[k - 1][0], surface[k][1] - surface[k - 1][1]);

    const marks: DevMark[] = [];
    for (let k = 0; k <= per; k++) {
      const gi = i0 + k;
      if (gi % markStep === 0) marks.push({ a: A[k], b: surface[k], label: String((gi / markStep) % 8) });
    }

    const part = normalize({ outer: B, inner: A, surface, marks, width: 0, height: 0 });
    if (polygonSelfIntersects([...part.outer, ...[...part.inner].reverse()])) overlaps = true;
    parts.push(part);
  }

  return { parts, tipLength, rootLength, surfaceLength, stripHeight: rTip - rRoot, overlaps };
}

/** Раскладка частей на листе полками (слева направо, сверху вниз). Смещения — левый верхний угол части от верха листа. */
export function nestParts(dev: Development, spacing = 10) {
  const maxW = Math.max(...dev.parts.map((p) => p.width));
  const area = dev.parts.reduce((s, p) => s + (p.width + spacing) * (p.height + spacing), 0);
  const rowLimit = Math.max(maxW, Math.sqrt(area) * 1.6);
  const offsets: V2[] = [];
  let x = 0, y = 0, rowH = 0, w = 0;
  for (const part of dev.parts) {
    if (x > 0 && x + part.width > rowLimit) {
      x = 0;
      y += rowH + spacing;
      rowH = 0;
    }
    offsets.push([x, y]);
    x += part.width + spacing;
    w = Math.max(w, x - spacing);
    rowH = Math.max(rowH, part.height);
  }
  return { offsets, width: w, height: y + rowH };
}
