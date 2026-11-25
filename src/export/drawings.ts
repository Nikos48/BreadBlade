import type { Layout } from '../geometry/layout';
import { nestParts, type DevPart } from '../geometry/develop';
import type { V2 } from '../geometry/contour';

/**
 * Чертежи в миллиметрах: трафарет лезвия (развёртка) и шаблон разметки ролика.
 * Один и тот же набор примитивов уходит и в SVG, и в DXF — чтобы превью
 * на экране точно совпадало с тем, что поедет на лазер.
 */

export type Layer = 'cut' | 'engrave' | 'note' | 'frame';

export type Prim =
  | { kind: 'poly'; layer: Layer; pts: V2[]; closed: boolean; dashed?: boolean }
  | { kind: 'text'; layer: Layer; at: V2; text: string; size: number; anchor?: 'start' | 'middle' | 'end' };

export interface Drawing {
  /** ширина и высота листа, мм; координаты — y вверх, начало в левом нижнем углу */
  width: number;
  height: number;
  prims: Prim[];
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');

function scaleBar(prims: Prim[], x: number, y: number) {
  prims.push({ kind: 'poly', layer: 'note', pts: [[x, y + 3], [x, y], [x + 100, y], [x + 100, y + 3]], closed: false });
  for (let i = 10; i < 100; i += 10) prims.push({ kind: 'poly', layer: 'note', pts: [[x + i, y], [x + i, y + 1.5]], closed: false });
  prims.push({ kind: 'text', layer: 'note', at: [x + 50, y + 4.5], text: 'контроль масштаба: 100 мм', size: 3.5, anchor: 'middle' });
}

export function stencilDrawing(L: Layout): Drawing {
  const dev = L.development;
  const pad = 12;
  const header = 42;
  const { offsets, width, height } = nestParts(dev, 12);
  const W = Math.max(width, 130) + pad * 2;
  const H = height + pad * 2 + header;
  const prims: Prim[] = [];
  const P = L.params;

  dev.parts.forEach((part, i) => {
    const ox = pad + offsets[i][0], oy = pad + (height - offsets[i][1] - part.height);
    const sh = ([x, y]: V2): V2 => [x + ox, y + oy];
    prims.push({ kind: 'poly', layer: 'cut', pts: [...part.outer, ...[...part.inner].reverse()].map(sh), closed: true });
    if (P.embed > 0.05) prims.push({ kind: 'poly', layer: 'engrave', pts: part.surface.map(sh), closed: false, dashed: true });
    for (const m of part.marks) {
      prims.push({ kind: 'poly', layer: 'engrave', pts: [sh(m.a), sh(m.b)], closed: false });
      const dx = m.a[0] - m.b[0], dy = m.a[1] - m.b[1];
      const l = Math.hypot(dx, dy) || 1;
      const at = sh([m.a[0] + (dx / l) * 4.5, m.a[1] + (dy / l) * 4.5 - 1.3]);
      prims.push({ kind: 'text', layer: 'engrave', at, text: m.label, size: 3.2, anchor: 'middle' });
    }
    if (dev.parts.length > 1)
      prims.push({ kind: 'text', layer: 'note', at: [ox + part.width / 2, oy - 5.5], text: `часть ${i + 1} из ${dev.parts.length}`, size: 3, anchor: 'middle' });
  });

  // штамп
  const top = H - pad;
  const lines = [
    `BreadBlade — трафарет лезвия · ${dev.parts.length > 1 ? `частей: ${dev.parts.length}` : 'целиком'} · сталь ${fmt(P.thickness)} мм`,
    `лаваш ${fmt(2 * L.contour.halfX)}×${fmt(2 * L.contour.halfY)} мм · ролик Ø${fmt(2 * L.rSurface)} мм · высота полосы ${fmt(dev.stripHeight)} мм (над роликом ${fmt(P.bladeHeight)}, в пазу ${fmt(P.embed)})`,
    `длина кромки ${fmt(dev.tipLength)} мм · сплошная — рез, пунктир — граница паза, риски — метки совмещения с шаблоном ролика`,
  ];
  lines.forEach((t, i) => prims.push({ kind: 'text', layer: 'note', at: [pad, top - 4 - i * 6], text: t, size: i === 0 ? 4.2 : 3.2 }));
  scaleBar(prims, pad, top - 29);

  return { width: W, height: H, prims };
}

/**
 * Уникальные детали лезвия. Из-за симметрии контура части развёртки повторяются:
 * при 2 и 4 частях все детали одинаковые (зеркальные — это та же деталь, перевёрнутая),
 * при 8 частях — два разных вида по 4 шт.
 */
export function uniqueParts(L: Layout): { part: DevPart; count: number }[] {
  const parts = L.development.parts;
  const n = parts.length;
  if (n === 8) return [{ part: parts[0], count: 4 }, { part: parts[1], count: 4 }];
  return [{ part: parts[0], count: n }];
}

function rotatePart(part: DevPart, angle: number): DevPart {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = ([x, y]: V2): V2 => [x * c - y * s, x * s + y * c];
  const outer = part.outer.map(r), inner = part.inner.map(r), surface = part.surface.map(r);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [...outer, ...inner]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const t = ([x, y]: V2): V2 => [x - x0, y - y0];
  return {
    outer: outer.map(t), inner: inner.map(t), surface: surface.map(t),
    marks: part.marks.map((m) => ({ ...m, a: t(r(m.a)), b: t(r(m.b)) })),
    width: x1 - x0, height: y1 - y0,
  };
}

/** Чертёж только уникальных деталей — для ручной резки по бумажному шаблону. angle — поворот деталей, рад. */
export function partDrawing(L: Layout, angle = 0): Drawing {
  const P = L.params;
  const items = uniqueParts(L).map((u) => ({ ...u, part: rotatePart(u.part, angle) }));
  const pad = 10, header = 30, gapY = 14;
  const partsH = items.reduce((s, it) => s + it.part.height, 0) + gapY * (items.length - 1);
  const W = Math.max(...items.map((it) => it.part.width), 120) + pad * 2;
  const H = partsH + pad * 2 + header;
  const prims: Prim[] = [];

  let yTop = pad + partsH;
  items.forEach((it, i) => {
    const part = it.part;
    const ox = pad, oy = yTop - part.height;
    const sh = ([x, y]: V2): V2 => [x + ox, y + oy];
    prims.push({ kind: 'poly', layer: 'cut', pts: [...part.outer, ...[...part.inner].reverse()].map(sh), closed: true });
    if (P.embed > 0.05) prims.push({ kind: 'poly', layer: 'engrave', pts: part.surface.map(sh), closed: false, dashed: true });
    for (const m of part.marks) prims.push({ kind: 'poly', layer: 'engrave', pts: [sh(m.a), sh(m.b)], closed: false });
    const name = items.length > 1 ? `деталь ${'АБ'[i]}` : 'деталь';
    const mid = part.inner[Math.floor(part.inner.length / 2)];
    prims.push({ kind: 'text', layer: 'note', at: sh([mid[0], Math.max(-6, mid[1] - 6)]), text: `${name} · ${it.count} шт.`, size: 4, anchor: 'middle' });
    yTop = oy - gapY;
  });

  const top = H - pad;
  const total = items.reduce((s, it) => s + it.count, 0);
  const lines = [
    `BreadBlade — шаблон детали лезвия для ручной резки · сталь ${fmt(P.thickness)} мм`,
    [items.length > 1 ? `детали А и Б — по ${items[0].count} шт.` : `вырезать ${total} шт. по одному шаблону`, total > 1 ? 'половина деталей при монтаже ставится перевёрнутой' : '']
      .filter(Boolean).join(' · '),
    `вырежьте шаблон по красной линии, обведите на стали чертилкой · риски — метки совмещения с шаблоном ролика`,
  ];
  lines.forEach((t, i) => prims.push({ kind: 'text', layer: 'note', at: [pad, top - 4 - i * 5.5], text: t, size: i === 0 ? 3.8 : 3 }));
  return { width: W, height: H, prims };
}

export function templateDrawing(L: Layout): Drawing {
  const circ = 2 * Math.PI * L.rSurface;
  const len = L.cylLength;
  const glue = 15;
  const pad = 12, header = 22;
  const W = circ + glue + pad * 2;
  const H = len + pad * 2 + header;
  const ox = pad, oy = pad;
  const prims: Prim[] = [];
  const pts = L.contour.points;
  const k = L.rSurface / L.rTip;
  const Q = L.contour.quarter;

  prims.push({ kind: 'poly', layer: 'frame', pts: [[ox, oy], [ox + circ, oy], [ox + circ, oy + len], [ox, oy + len]], closed: true });
  prims.push({
    kind: 'poly', layer: 'frame', dashed: true, closed: false,
    pts: [[ox + circ, oy], [ox + circ + glue, oy + 6], [ox + circ + glue, oy + len - 6], [ox + circ, oy + len]],
  });
  prims.push({ kind: 'text', layer: 'note', at: [ox + circ + glue / 2, oy + len / 2], text: 'клей', size: 3, anchor: 'middle' });
  // ось лавашей
  prims.push({ kind: 'poly', layer: 'frame', dashed: true, closed: false, pts: [[ox, oy + len / 2], [ox + circ, oy + len / 2]] });
  // риски каждые 10 мм по краям
  for (let u = 0; u <= circ; u += 10) {
    const big = Math.round(u) % 50 === 0;
    prims.push({ kind: 'poly', layer: 'note', closed: false, pts: [[ox + u, oy], [ox + u, oy + (big ? 4 : 2)]] });
    prims.push({ kind: 'poly', layer: 'note', closed: false, pts: [[ox + u, oy + len], [ox + u, oy + len - (big ? 4 : 2)]] });
  }

  for (const cx of L.centers) {
    const map = ([x, y]: V2): V2 => [ox + circ / 2 + (cx + x) * k, oy + len / 2 + y];
    prims.push({ kind: 'poly', layer: 'cut', pts: pts.map(map), closed: true });
    for (let i = 0; i < pts.length; i += Q / 2) {
      const p = map(pts[i]);
      prims.push({ kind: 'poly', layer: 'engrave', closed: false, pts: [[p[0] - 3, p[1]], [p[0] + 3, p[1]]] });
      prims.push({ kind: 'poly', layer: 'engrave', closed: false, pts: [[p[0], p[1] - 3], [p[0], p[1] + 3]] });
      const [x, y] = pts[i];
      const r = Math.hypot(x, y) || 1;
      prims.push({ kind: 'text', layer: 'engrave', at: [p[0] - (x / r) * 7, p[1] - (y / r) * 7 - 1.5], text: String((i / (Q / 2)) % 8), size: 4, anchor: 'middle' });
    }
  }
  const top = H - pad;
  prims.push({ kind: 'text', layer: 'note', at: [pad, top - 4], text: `BreadBlade — шаблон разметки ролика (обернуть вокруг Ø${fmt(2 * L.rSurface)} мм, длина ${fmt(len)} мм)`, size: 4.2 });
  prims.push({ kind: 'text', layer: 'note', at: [pad, top - 10], text: 'линия — паз под лезвие, цифры — метки совмещения с трафаретом. Печатать 1:1.', size: 3.2 });
  scaleBar(prims, W - pad - 100, top - 12);
  return { width: W, height: H, prims };
}

/* --------------------------- SVG --------------------------- */

const STYLE: Record<Layer, { stroke: string; width: number }> = {
  cut: { stroke: '#e0402a', width: 0.3 },
  engrave: { stroke: '#2a7de0', width: 0.25 },
  note: { stroke: '#555', width: 0.2 },
  frame: { stroke: '#888', width: 0.25 },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toSvg(d: Drawing, opts: { screen?: boolean } = {}): string {
  const size = opts.screen ? '' : ` width="${d.width.toFixed(2)}mm" height="${d.height.toFixed(2)}mm"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${d.width.toFixed(2)} ${d.height.toFixed(2)}" font-family="Arial, sans-serif">`,
    opts.screen ? '' : `<rect width="100%" height="100%" fill="#fff"/>`,
    svgBody(d),
    '</svg>',
  ].join('\n');
}

/** Содержимое чертежа как SVG-элементы (мм, y вниз, начало — левый верхний угол листа). */
export function svgBody(d: Drawing): string {
  const Y = (y: number) => d.height - y;
  const out: string[] = [];
  for (const p of d.prims) {
    const st = STYLE[p.layer];
    if (p.kind === 'poly') {
      const pts = p.pts.map(([x, y]) => `${x.toFixed(3)},${Y(y).toFixed(3)}`).join(' ');
      const tag = p.closed ? 'polygon' : 'polyline';
      const dash = p.dashed ? ' stroke-dasharray="3 2"' : '';
      out.push(`<${tag} class="l-${p.layer}" points="${pts}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dash} stroke-linejoin="round"/>`);
    } else {
      out.push(`<text class="t-${p.layer}" x="${p.at[0].toFixed(2)}" y="${Y(p.at[1]).toFixed(2)}" font-size="${p.size}" fill="${p.layer === 'engrave' ? st.stroke : '#333'}" text-anchor="${p.anchor ?? 'start'}">${esc(p.text)}</text>`);
    }
  }
  return out.join('\n');
}

/* --------------------------- DXF (R12) --------------------------- */

const DXF_LAYER: Record<Layer, { name: string; color: number }> = {
  cut: { name: 'CUT', color: 1 },
  engrave: { name: 'MARK', color: 5 },
  note: { name: 'NOTES', color: 8 },
  frame: { name: 'FRAME', color: 8 },
};

/** Транслитерация для старых DXF-читателей, которые не дружат с кириллицей. */
function translit(s: string): string {
  const m: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return s
    .split('')
    .map((ch) => {
      const lo = ch.toLowerCase();
      if (!(lo in m)) return ch === '—' ? '-' : ch === '×' ? 'x' : ch === 'Ø' ? 'D' : ch === '·' ? '|' : ch;
      const t = m[lo];
      return ch === lo ? t : t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join('');
}

export function toDxf(d: Drawing, opts: { onlyLayers?: Layer[] } = {}): string {
  const o: (string | number)[] = [];
  const g = (code: number, v: string | number) => o.push(code, typeof v === 'number' ? v.toFixed(4) : v);
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); o.push(70, 4);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); o.push(70, 4);
  for (const l of Object.values(DXF_LAYER)) {
    g(0, 'LAYER'); g(2, l.name); o.push(70, 0, 62, l.color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const p of d.prims) {
    if (opts.onlyLayers && !opts.onlyLayers.includes(p.layer)) continue;
    const layer = DXF_LAYER[p.layer].name;
    if (p.kind === 'poly') {
      g(0, 'POLYLINE'); g(8, layer); o.push(66, 1); g(10, 0); g(20, 0); g(30, 0); o.push(70, p.closed ? 1 : 0);
      for (const [x, y] of p.pts) {
        g(0, 'VERTEX'); g(8, layer); g(10, x); g(20, y); g(30, 0);
      }
      g(0, 'SEQEND'); g(8, layer);
    } else {
      g(0, 'TEXT'); g(8, layer); g(10, p.at[0]); g(20, p.at[1]); g(30, 0); g(40, p.size); g(1, translit(p.text));
      if (p.anchor && p.anchor !== 'start') {
        o.push(72, p.anchor === 'middle' ? 1 : 2);
        g(11, p.at[0]); g(21, p.at[1]); g(31, 0);
      }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  const lines: string[] = [];
  for (let i = 0; i < o.length; i += 2) lines.push(String(o[i]), String(o[i + 1]));
  return lines.join('\r\n') + '\r\n';
}
