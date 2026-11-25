import { partDrawing, svgBody, type Drawing } from './drawings';
import type { Layout } from '../geometry/layout';

/**
 * Печать чертежа 1:1 на листах A4 с перекрытием.
 *
 * Первая страница — схема склейки (весь чертёж в уменьшенном виде с сеткой листов).
 * Дальше — листы A1, A2, B1… (строка — буква, столбец — цифра). Пустые листы пропускаются.
 * У каждого листа поле 10 мм (влезает в любой принтер) и полоса перекрытия OVERLAP:
 * её содержимое повторяется на соседнем листе, по нему листы совмещаются.
 */

const A4 = { w: 210, h: 297 };
const MARGIN = 10;
export const OVERLAP = 12;

export interface Tile {
  row: number;
  col: number;
  name: string;
  /** левый верхний угол области чертежа на листе, мм (y вниз) */
  x: number;
  y: number;
}

export interface TilePlan {
  landscape: boolean;
  pageW: number;
  pageH: number;
  cw: number;
  ch: number;
  rows: number;
  cols: number;
  tiles: Tile[];
}

const rowName = (r: number) => String.fromCharCode(65 + (r % 26)) + (r >= 26 ? Math.floor(r / 26) : '');

function grid(d: Drawing, landscape: boolean) {
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const cw = pageW - 2 * MARGIN, ch = pageH - 2 * MARGIN;
  const cols = Math.max(1, Math.ceil((d.width - OVERLAP) / (cw - OVERLAP)));
  const rows = Math.max(1, Math.ceil((d.height - OVERLAP) / (ch - OVERLAP)));
  return { landscape, pageW, pageH, cw, ch, cols, rows };
}

/** Есть ли на участке чертежа хоть что-то (по вершинам ломаных и точкам текста). */
function tileHasContent(d: Drawing, x: number, y: number, w: number, h: number): boolean {
  const inside = (px: number, py: number) => {
    const sy = d.height - py; // в координаты листа (y вниз)
    return px >= x && px <= x + w && sy >= y && sy <= y + h;
  };
  for (const p of d.prims) {
    if (p.kind === 'text') {
      if (inside(p.at[0], p.at[1])) return true;
      continue;
    }
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i];
      if (inside(a[0], a[1])) return true;
      // длинные отрезки без вершин внутри — проверяем середину и четверти
      const b = p.pts[i + 1] ?? (p.closed ? p.pts[0] : null);
      if (!b) continue;
      for (const t of [0.25, 0.5, 0.75]) if (inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true;
    }
  }
  return false;
}

export function planTiles(d: Drawing): TilePlan {
  const opts = [grid(d, false), grid(d, true)];
  const g = opts.sort((p, q) => p.rows * p.cols - q.rows * q.cols)[0];
  const tiles: Tile[] = [];
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const x = c * (g.cw - OVERLAP), y = r * (g.ch - OVERLAP);
      if (tileHasContent(d, x, y, g.cw, g.ch)) tiles.push({ row: r, col: c, name: `${rowName(r)}${c + 1}`, x, y });
    }
  return { ...g, tiles };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function tiledPrintHtml(d: Drawing, title: string): { html: string; plan: TilePlan } {
  const plan = planTiles(d);
  const { pageW, pageH, cw, ch, tiles } = plan;
  const body = svgBody(d);
  const pages: string[] = [];
  const names = new Map(tiles.map((t) => [`${t.row}:${t.col}`, t.name]));

  // ---------- схема склейки ----------
  const ovW = pageW - 2 * MARGIN, ovH = pageH - 2 * MARGIN - 70;
  const gridRects = tiles
    .map((t) => `<rect x="${t.x}" y="${t.y}" width="${cw}" height="${ch}" fill="rgba(255,138,61,0.06)" stroke="#ff8a3d" stroke-width="${Math.max(d.width, d.height) / 400}"/>
      <text x="${t.x + cw / 2}" y="${t.y + ch / 2}" font-size="${Math.min(cw, ch) / 3.2}" fill="rgba(255,100,30,0.55)" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${t.name}</text>`)
    .join('');
  const allW = Math.max(d.width, (plan.cols - 1) * (cw - OVERLAP) + cw);
  const allH = Math.max(d.height, (plan.rows - 1) * (ch - OVERLAP) + ch);
  pages.push(`
    <section class="page">
      <div class="content" style="left:${MARGIN}mm;top:${MARGIN}mm;width:${ovW}mm">
        <h1>${esc(title)} — печать на A4</h1>
        <p>Листов: <b>${tiles.length}</b> (${plan.landscape ? 'альбомная' : 'книжная'} ориентация), чертёж ${Math.round(d.width)} × ${Math.round(d.height)} мм.</p>
        <ol>
          <li>В окне печати: масштаб <b>100% / «фактический размер»</b>, поля — <b>«нет»</b> или минимальные. Не включайте «вписать в страницу».</li>
          <li>На каждом листе проверьте линейкой контрольный отрезок <b>50 мм</b> внизу.</li>
          <li>Раскладывайте листы по схеме ниже. У листа, который ложится сверху, срежьте поле по пунктиру слева/сверху и совместите линии с соседом, затем склейте.</li>
        </ol>
      </div>
      <svg class="content" style="left:${MARGIN}mm;top:${MARGIN + 66}mm" width="${ovW}mm" height="${ovH}mm" viewBox="-2 -2 ${allW + 4} ${allH + 4}" preserveAspectRatio="xMidYMin meet" font-family="Arial, sans-serif">
        <rect x="0" y="0" width="${d.width}" height="${d.height}" fill="#fff" stroke="#bbb" stroke-width="${Math.max(d.width, d.height) / 600}"/>
        ${body}
        ${gridRects}
      </svg>
    </section>`);

  // ---------- листы ----------
  tiles.forEach((t, i) => {
    const sw = 0.25;
    const marks: string[] = [];
    const L = t.col > 0, T = t.row > 0;
    const R = t.col < plan.cols - 1, B = t.row < plan.rows - 1;
    // полосы перекрытия справа/снизу: сюда ляжет соседний лист
    if (R) marks.push(`<rect x="${t.x + cw - OVERLAP}" y="${t.y}" width="${OVERLAP}" height="${ch}" fill="rgba(90,162,255,0.10)"/>`);
    if (B) marks.push(`<rect x="${t.x}" y="${t.y + ch - OVERLAP}" width="${cw}" height="${OVERLAP}" fill="rgba(90,162,255,0.10)"/>`);
    // линии среза слева/сверху: по ним обрезать этот лист
    if (L) marks.push(`<line x1="${t.x + OVERLAP}" y1="${t.y}" x2="${t.x + OVERLAP}" y2="${t.y + ch}" stroke="#2a7de0" stroke-width="${sw}" stroke-dasharray="4 2"/>`);
    if (T) marks.push(`<line x1="${t.x}" y1="${t.y + OVERLAP}" x2="${t.x + cw}" y2="${t.y + OVERLAP}" stroke="#2a7de0" stroke-width="${sw}" stroke-dasharray="4 2"/>`);
    marks.push(`<rect x="${t.x}" y="${t.y}" width="${cw}" height="${ch}" fill="none" stroke="#999" stroke-width="0.2"/>`);

    const nb = (dr: number, dc: number) => names.get(`${t.row + dr}:${t.col + dc}`);
    const side = (txt: string, x: number, y: number, rot = 0) =>
      `<text x="${x}" y="${y}" font-size="3.2" fill="#2a7de0" text-anchor="middle" transform="rotate(${rot} ${x} ${y})">${txt}</text>`;
    const edge: string[] = [];
    if (L && nb(0, -1)) edge.push(side(`✂ срезать по пунктиру · на ${nb(0, -1)}`, MARGIN - 3.5, pageH / 2, -90));
    if (R && nb(0, 1)) edge.push(side(`под лист ${nb(0, 1)} →`, pageW - MARGIN + 6, pageH / 2, -90));
    if (T && nb(-1, 0)) edge.push(side(`✂ срезать по пунктиру · на ${nb(-1, 0)}`, pageW / 2, MARGIN - 3));
    if (B && nb(1, 0)) edge.push(side(`под лист ${nb(1, 0)} ↓`, pageW / 2, pageH - MARGIN + 5.5));

    pages.push(`
      <section class="page">
        <svg class="content" style="left:${MARGIN}mm;top:${MARGIN}mm" width="${cw}mm" height="${ch}mm" viewBox="${t.x} ${t.y} ${cw} ${ch}" font-family="Arial, sans-serif">
          ${body}
          ${marks.join('')}
        </svg>
        <svg class="frame" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}" font-family="Arial, sans-serif">
          <text x="${MARGIN}" y="${MARGIN - 4}" font-size="5" font-weight="bold" fill="#e0402a">${t.name}</text>
          <text x="${pageW - MARGIN}" y="${MARGIN - 4}" font-size="3" fill="#666" text-anchor="end">${esc(title)} · лист ${i + 1} из ${tiles.length}</text>
          <g transform="translate(${pageW - MARGIN - 50} ${pageH - 4.5})">
            <path d="M0,-2 V0 H50 V-2" fill="none" stroke="#333" stroke-width="0.25"/>
            <text x="-2" y="0" font-size="2.6" fill="#333" text-anchor="end">50 мм</text>
          </g>
          ${edge.join('')}
        </svg>
      </section>`);
  });

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)} — A4</title>
<style>
  @page { size: A4 ${plan.landscape ? 'landscape' : 'portrait'}; margin: 0; }
  html, body { margin: 0; background: #888; font-family: Arial, sans-serif; }
  .page { position: relative; width: ${pageW}mm; height: ${pageH}mm; background: #fff; overflow: hidden;
          page-break-after: always; break-after: page; margin: 0 auto; }
  .page + .page { margin-top: 8mm; }
  .content, .frame { position: absolute; }
  .frame { left: 0; top: 0; pointer-events: none; }
  h1 { font-size: 16pt; margin: 0 0 3mm; }
  p, li { font-size: 10pt; line-height: 1.4; margin: 0 0 1.5mm; }
  ol { padding-left: 5mm; margin: 2mm 0 0; }
  @media print { html, body { background: #fff; } .page + .page { margin-top: 0; } }
</style></head><body>${pages.join('')}
<script>window.addEventListener('load', () => setTimeout(() => print(), 400));<\/script>
</body></html>`;
  return { html, plan };
}

/** Чертёж уникальных деталей, повёрнутый так, чтобы при печати на A4 ушло меньше всего листов. */
export function bestPartDrawing(L: Layout): { drawing: Drawing; sheets: number } {
  let best: { drawing: Drawing; sheets: number; area: number } | null = null;
  for (let deg = 0; deg < 180; deg += 5) {
    const d = partDrawing(L, (deg * Math.PI) / 180);
    const sheets = planTiles(d).tiles.length;
    const area = d.width * d.height;
    if (!best || sheets < best.sheets || (sheets === best.sheets && area < best.area - 1)) best = { drawing: d, sheets, area };
  }
  return { drawing: best!.drawing, sheets: best!.sheets };
}
