import type { Layout } from '../geometry/layout';

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');

/**
 * Вид сверху на лаваш. Для формы «Свой контур» точки I четверти можно таскать
 * (остальные три четверти — зеркальные), двойной клик — добавить точку,
 * правый клик по точке — удалить.
 */
export class ContourEditor {
  private svg = el('svg');
  private layout: Layout | null = null;
  private drag: number | null = null;

  constructor(host: HTMLElement, private onPoints: (pts: [number, number][]) => void) {
    this.svg.classList.add('contour-svg');
    host.appendChild(this.svg);
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', () => (this.drag = null));
    this.svg.addEventListener('pointerleave', () => (this.drag = null));
    this.svg.addEventListener('dblclick', (e) => this.add(e));
  }

  private toModel(e: MouseEvent): [number, number] {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [p.x, -p.y];
  }

  private norm([x, y]: [number, number]): [number, number] {
    const P = this.layout!.params;
    const a = P.length / 2, b = P.width / 2;
    return [Math.min(1.4, Math.max(0.02, x / a)), Math.min(1.4, Math.max(0.02, y / b))];
  }

  private move(e: PointerEvent) {
    if (this.drag === null || !this.layout) return;
    const pts = this.layout.params.customPoints.map((p) => [...p] as [number, number]);
    pts[this.drag] = this.norm(this.toModel(e));
    this.onPoints(pts);
  }

  private add(e: MouseEvent) {
    if (!this.layout || this.layout.params.shape !== 'custom') return;
    const pts = this.layout.params.customPoints.map((p) => [...p] as [number, number]);
    if (pts.length >= 10) return;
    const [x, y] = this.toModel(e);
    pts.push(this.norm([Math.abs(x), Math.abs(y)]));
    this.onPoints(pts);
  }

  render(layout: Layout) {
    this.layout = layout;
    const { contour, params } = layout;
    const a = contour.halfX, b = contour.halfY;
    const m = Math.max(a, b) * 0.22 + 20;
    this.svg.setAttribute('viewBox', `${-a - m} ${-b - m} ${2 * (a + m)} ${2 * (b + m)}`);
    this.svg.replaceChildren();
    const sw = Math.max(a, b) / 260; // «пиксель» в мм

    const g = el('g', { transform: 'scale(1,-1)' });
    this.svg.appendChild(g);

    // сетка 50 мм
    const grid = el('g', { class: 'grid' });
    for (let x = -Math.floor((a + m) / 50) * 50; x <= a + m; x += 50)
      grid.appendChild(el('line', { x1: x, y1: -b - m, x2: x, y2: b + m, 'stroke-width': sw }));
    for (let y = -Math.floor((b + m) / 50) * 50; y <= b + m; y += 50)
      grid.appendChild(el('line', { x1: -a - m, y1: y, x2: a + m, y2: y, 'stroke-width': sw }));
    g.appendChild(grid);
    g.appendChild(el('line', { class: 'axis', x1: -a - m, y1: 0, x2: a + m, y2: 0, 'stroke-width': sw }));
    g.appendChild(el('line', { class: 'axis', x1: 0, y1: -b - m, x2: 0, y2: b + m, 'stroke-width': sw }));

    const d = 'M' + contour.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
    g.appendChild(el('path', { class: 'dough', d }));
    g.appendChild(el('path', { class: 'outline', d, 'stroke-width': sw * 2.2 }));

    // направление прокатки
    const arrowY = -b - m * 0.55;
    g.appendChild(el('line', { class: 'dim', x1: -a * 0.25, y1: arrowY, x2: a * 0.25, y2: arrowY, 'stroke-width': sw * 1.5, 'marker-end': 'url(#arr)' }));
    const defs = el('defs');
    const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    mk.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrowhead' }));
    defs.appendChild(mk);
    this.svg.appendChild(defs);

    // размеры (текст рисуем без отражения)
    const fs = Math.max(a, b) / 16;
    const text = (x: number, y: number, s: string, cls = 'dimtext') => {
      const t = el('text', { x, y: -y, class: cls, 'font-size': fs, 'text-anchor': 'middle' });
      t.textContent = s;
      this.svg.appendChild(t);
    };
    text(0, arrowY - fs * 1.2, 'прокатка');
    text(0, b + m * 0.35, `${fmt(2 * a)} мм`);
    const vt = el('text', { x: 0, y: 0, class: 'dimtext', 'font-size': fs, 'text-anchor': 'middle', transform: `translate(${-a - m * 0.4} 0) rotate(-90)` });
    vt.textContent = `${fmt(2 * b)} мм`;
    this.svg.appendChild(vt);

    if (params.shape === 'custom') {
      const A = params.length / 2, B = params.width / 2;
      params.customPoints.forEach(([u, v], i) => {
        const x = u * A, y = v * B;
        for (const [sx, sy] of [[-1, 1], [-1, -1], [1, -1]])
          g.appendChild(el('circle', { class: 'ghost', cx: sx * x, cy: sy * y, r: sw * 4 }));
        const h = el('circle', { class: 'handle', cx: x, cy: y, r: sw * 7 });
        h.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.svg.setPointerCapture(e.pointerId);
          this.drag = i;
        });
        h.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (params.customPoints.length <= 1) return;
          this.onPoints(params.customPoints.filter((_, j) => j !== i));
        });
        g.appendChild(h);
      });
      for (const [x, y] of [[A, 0], [0, B]]) g.appendChild(el('circle', { class: 'anchor', cx: x, cy: y, r: sw * 5 }));
    }
  }
}
