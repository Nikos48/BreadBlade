import './style.css';
import { DEFAULT_PARAMS, loadParams, saveParams, shareUrl, type Params } from './params';
import { computeLayout, type Layout } from './geometry/layout';
import { Viewer } from './scene/viewer';
import { ContourEditor } from './ui/contourEditor';
import { makeZoomable } from './ui/zoom';
import { bestPartDrawing, planTiles, tiledPrintHtml } from './export/print';
import { uniqueParts, stencilDrawing, templateDrawing, toDxf, toSvg } from './export/drawings';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU');

let params: Params = loadParams();
let layout: Layout = computeLayout(params);

/* ------------------------------ поля ввода ------------------------------ */

type NumKey = 'length' | 'width' | 'squareness' | 'cornerRadius' | 'perRev' | 'gap' | 'margin' | 'bladeHeight' | 'embed' | 'thickness';
interface FieldDef { key: NumKey; name: string; min: number; max: number; step: number; unit: string }

const FIELDS: FieldDef[] = [
  { key: 'length', name: 'Длина (по ходу прокатки)', min: 80, max: 1200, step: 1, unit: 'мм' },
  { key: 'width', name: 'Ширина (вдоль ролика)', min: 50, max: 1000, step: 1, unit: 'мм' },
  { key: 'squareness', name: 'Квадратность', min: 2, max: 10, step: 0.05, unit: '' },
  { key: 'cornerRadius', name: 'Радиус углов', min: 2, max: 300, step: 1, unit: 'мм' },
  { key: 'perRev', name: 'Лавашей за оборот', min: 1, max: 6, step: 1, unit: 'шт' },
  { key: 'gap', name: 'Зазор между лавашами', min: 0, max: 100, step: 1, unit: 'мм' },
  { key: 'margin', name: 'Поле ролика с торца', min: 0, max: 100, step: 1, unit: 'мм' },
  { key: 'bladeHeight', name: 'Высота над роликом', min: 2, max: 40, step: 0.5, unit: 'мм' },
  { key: 'embed', name: 'Заглубление в паз', min: 0, max: 20, step: 0.5, unit: 'мм' },
  { key: 'thickness', name: 'Толщина стали', min: 0.2, max: 3, step: 0.05, unit: 'мм' },
];

const inputs = new Map<NumKey, { range: HTMLInputElement; num: HTMLInputElement }>();

for (const f of FIELDS) {
  const host = $(`#f-${f.key}`);
  host.classList.add('field');
  host.innerHTML = `
    <div class="top"><span class="name">${f.name}</span>
      <span class="val"><input type="number" min="${f.min}" max="${f.max * 3}" step="${f.step}"><span class="unit">${f.unit}</span></span>
    </div>
    <input type="range" min="${f.min}" max="${f.max}" step="${f.step}">`;
  const num = host.querySelector('input[type=number]') as HTMLInputElement;
  const range = host.querySelector('input[type=range]') as HTMLInputElement;
  const set = (v: number, from: 'range' | 'num') => {
    if (!Number.isFinite(v)) return;
    v = Math.max(f.min, v);
    if (from === 'range') num.value = String(v);
    else range.value = String(v);
    update({ [f.key]: v } as Partial<Params>);
  };
  range.addEventListener('input', () => set(Number(range.value), 'range'));
  num.addEventListener('change', () => set(Number(num.value), 'num'));
  inputs.set(f.key, { range, num });
}

function syncInputs() {
  for (const [key, { range, num }] of inputs) {
    const v = params[key];
    if (document.activeElement !== num) num.value = String(Math.round(v * 1000) / 1000);
    range.value = String(v);
  }
  document.querySelectorAll<HTMLButtonElement>('#shape button').forEach((b) => b.classList.toggle('on', b.dataset.v === params.shape));
  document.querySelectorAll<HTMLButtonElement>('#split button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === params.split));
  document.querySelectorAll<HTMLElement>('[data-shape]').forEach((e) => (e.style.display = e.dataset.shape === params.shape ? '' : 'none'));
}

$('#shape').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).dataset.v as Params['shape'] | undefined;
  if (!v) return;
  update({ shape: v });
  if (v === 'custom') selectTab('contour');
});
$('#split').addEventListener('click', (e) => {
  const raw = (e.target as HTMLElement).dataset.v;
  if (raw === undefined) return;
  const v = Number(raw);
  if (v === 0 || v === 1 || v === 2 || v === 4 || v === 8) {
    update({ split: v });
    selectTab('stencil');
  }
});

/* ------------------------------ вкладки ------------------------------ */

type Tab = 'stencil' | 'contour' | 'template';
let tab: Tab = 'stencil';
function selectTab(t: Tab) {
  tab = t;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll<HTMLElement>('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
  renderSheets();
}
$('#tabs').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).dataset.tab as Tab | undefined;
  if (t) selectTab(t);
});

/* ------------------------------ 3D ------------------------------ */

const viewer = new Viewer($('#view3d'));
const bend = $<HTMLInputElement>('#bend');
bend.addEventListener('input', () => viewer.setBend(Number(bend.value)));
viewer.onBend((k) => (bend.value = String(k)));
$('#roll').addEventListener('click', () => viewer.roll());
$('#fit').addEventListener('click', () => viewer.fitView());

const editor = new ContourEditor($('#pane-contour'), (pts) => update({ customPoints: pts }));

/* ------------------------------ обновление ------------------------------ */

let pending: Partial<Params> | null = null;
let lastDims = '';
function update(patch: Partial<Params>) {
  const first = !pending;
  pending = { ...(pending ?? {}), ...patch };
  if (first) queueMicrotask(flush);
}
function flush() {
  if (!pending) return;
  params = { ...params, ...pending };
  pending = null;
  layout = computeLayout(params);
  saveParams(params);
  render();
}

function render() {
  syncInputs();
  const dims = `${layout.circTip.toFixed(0)}|${layout.cylLength.toFixed(0)}`;
  viewer.setLayout(layout, lastDims !== '' && Math.abs(Number(dims.split('|')[0]) - Number(lastDims.split('|')[0])) > layout.circTip * 0.4);
  viewer.setBend(Number(bend.value));
  lastDims = dims;
  renderStats();
  renderSheets();
}

function renderStats() {
  const L = layout;
  const dev = L.development;
  const rows: [string, string, boolean?][] = [
    ['Ø ролика', `${fmt(2 * L.rSurface)} мм`, true],
    ['Ø по кромкам', `${fmt(2 * L.rTip)} мм`],
    ['Длина ролика', `${fmt(L.cylLength)} мм`, true],
    ['Ø дна паза', `${fmt(2 * L.rRoot)} мм`],
    ['Высота полосы', `${fmt(dev.stripHeight)} мм`, true],
    ['Длина кромки', `${fmt(dev.tipLength)} мм`],
    ['Длина по дну паза', `${fmt(dev.rootLength)} мм`],
    ['Периметр лаваша', `${fmt(L.contour.perimeter)} мм`],
    ['Площадь лаваша', `${fmt(L.contour.area / 1e4, 1)} дм²`],
    ['Мин. радиус гиба', `${fmt(L.minBendRadius)} мм`],
  ];
  $('#stats').innerHTML = rows.map(([k, v, big]) => `<dt>${k}</dt><dd class="${big ? 'big' : ''}">${v}</dd>`).join('');
  const pages = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'лист' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'листа' : 'листов'}`;
  const uniq = uniqueParts(L);
  const what = uniq.length > 1 ? 'Две детали' : L.development.parts.length === 4 ? 'Четверть' : 'Одна деталь';
  $('#print-part-a4').textContent = `${what} на A4 · ${pages(bestPartDrawing(L).sheets)} (ручная резка, ×${uniq[0].count})`;
  $('#print-stencil-a4').textContent = `Трафарет на A4 · ${pages(planTiles(stencilDrawing(L)).tiles.length)}`;
  $('#print-template-a4').textContent = `Шаблон ролика на A4 · ${pages(planTiles(templateDrawing(L)).tiles.length)}`;
  $('#warnings').innerHTML = L.warnings.map((w) => `<li>${w}</li>`).join('');
}

function renderSheets() {
  const info = $('#tab-info');
  if (tab === 'stencil') {
    const d = stencilDrawing(layout);
    $('#pane-stencil').innerHTML = `<div class="paper">${toSvg(d, { screen: true })}</div>`;
    makeZoomable($('#pane-stencil svg') as unknown as SVGSVGElement);
    info.textContent = `лист ${fmt(d.width, 0)} × ${fmt(d.height, 0)} мм · частей: ${layout.development.parts.length}`;
  } else if (tab === 'template') {
    const d = templateDrawing(layout);
    $('#pane-template').innerHTML = `<div class="paper">${toSvg(d, { screen: true })}</div>`;
    makeZoomable($('#pane-template svg') as unknown as SVGSVGElement);
    info.textContent = `развёртка поверхности ролика ${fmt(2 * Math.PI * layout.rSurface, 0)} × ${fmt(layout.cylLength, 0)} мм`;
  } else {
    editor.render(layout);
    info.textContent = `${fmt(2 * layout.contour.halfX, 0)} × ${fmt(2 * layout.contour.halfY, 0)} мм · вид сверху на тесто`;
  }
}

/* ------------------------------ экспорт ------------------------------ */

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName() {
  const P = params;
  return `breadblade_${P.shape}_${Math.round(2 * layout.contour.halfX)}x${Math.round(2 * layout.contour.halfY)}`;
}

function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

$('#dl-dxf').addEventListener('click', () => download(`${baseName()}_stencil.dxf`, toDxf(stencilDrawing(layout)), 'application/dxf'));
$('#dl-svg').addEventListener('click', () => download(`${baseName()}_stencil.svg`, toSvg(stencilDrawing(layout)), 'image/svg+xml'));
$('#dl-template').addEventListener('click', () => download(`${baseName()}_roller.svg`, toSvg(templateDrawing(layout)), 'image/svg+xml'));
$('#dl-template-dxf').addEventListener('click', () => download(`${baseName()}_roller.dxf`, toDxf(templateDrawing(layout)), 'application/dxf'));
$('#dl-stl').addEventListener('click', () => {
  const buf = viewer.exportStl();
  if (buf) download(`${baseName()}.stl`, buf, 'model/stl');
});
function printA4(d: ReturnType<typeof stencilDrawing>, title: string) {
  const w = window.open('', '_blank');
  if (!w) return toast('Браузер заблокировал окно печати — разрешите всплывающие окна');
  w.document.write(tiledPrintHtml(d, title).html);
  w.document.close();
}
$('#print-part-a4').addEventListener('click', () => printA4(bestPartDrawing(layout).drawing, `${baseName()} · деталь лезвия`));
$('#print-stencil-a4').addEventListener('click', () => printA4(stencilDrawing(layout), `${baseName()} · трафарет`));
$('#print-template-a4').addEventListener('click', () => printA4(templateDrawing(layout), `${baseName()} · шаблон ролика`));

$('#print-stencil').addEventListener('click', () => {
  const d = stencilDrawing(layout);
  const w = window.open('', '_blank');
  if (!w) return toast('Браузер заблокировал окно печати');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${baseName()} — трафарет</title>
    <style>@page{size:${Math.ceil(d.width)}mm ${Math.ceil(d.height)}mm;margin:0}html,body{margin:0}svg{display:block}</style></head>
    <body>${toSvg(d)}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
});
$('#share').addEventListener('click', async () => {
  const url = shareUrl(params);
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка с параметрами скопирована');
  } catch {
    history.replaceState(null, '', url);
    toast('Ссылка в адресной строке');
  }
});
$('#reset').addEventListener('click', () => {
  params = structuredClone(DEFAULT_PARAMS);
  history.replaceState(null, '', location.pathname);
  update({});
});

selectTab('stencil');
render();
