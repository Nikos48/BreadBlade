/**
 * Входные параметры. Все размеры — в миллиметрах.
 *
 * Система координат лаваша (вид сверху на тесто):
 *   x — направление прокатки (вдоль «длины» лаваша),
 *   y — вдоль оси ролика (поперёк, «ширина» лаваша).
 */

export type ShapeKind = 'oval' | 'rect' | 'custom';
/** 0 — авто: минимум частей, при котором развёртка не накладывается */
export type SplitParts = 0 | 1 | 2 | 4 | 8;

export interface Params {
  shape: ShapeKind;
  /** Длина лаваша вдоль прокатки, мм */
  length: number;
  /** Ширина лаваша вдоль оси ролика, мм */
  width: number;
  /** Показатель суперэллипса: 2 — эллипс, больше — «квадратнее» */
  squareness: number;
  /** Радиус скругления углов (для прямоугольника), мм */
  cornerRadius: number;
  /** Свои точки контура (I четверть), нормированы на полуоси: [u, v] ∈ ~[0..1] */
  customPoints: [number, number][];

  /** Сколько лавашей вырезается за один оборот ролика */
  perRev: number;
  /** Зазор между соседними лавашами по ходу прокатки, мм */
  gap: number;
  /** Поле ролика с каждого торца, мм */
  margin: number;

  /** Высота лезвия над поверхностью ролика, мм */
  bladeHeight: number;
  /** Заглубление лезвия в паз ролика, мм (входит в высоту трафарета) */
  embed: number;
  /** Толщина листа стали, мм */
  thickness: number;
  /** На сколько частей разбивать развёртку */
  split: SplitParts;
}

export const DEFAULT_PARAMS: Params = {
  shape: 'oval',
  length: 1000,
  width: 500,
  squareness: 2,
  cornerRadius: 60,
  customPoints: [
    [0.8089569091796875, 0.41851937866210936],
    [0.6294481201171875, 0.7918901977539062],
    [0.4, 0.98],
    [0.7845415649414063, 0.6834618530273437],
  ],
  perRev: 1,
  gap: 20,
  margin: 20,
  bladeHeight: 20,
  embed: 0,
  thickness: 1,
  split: 0,
};

const STORAGE_KEY = 'breadblade:params:v1';

function sanitize(raw: unknown): Params {
  const p: Params = structuredClone(DEFAULT_PARAMS);
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Params) => {
    const v = Number(r[k]);
    if (Number.isFinite(v)) (p as unknown as Record<string, unknown>)[k] = v;
  };
  (['length', 'width', 'squareness', 'cornerRadius', 'perRev', 'gap', 'margin', 'bladeHeight', 'embed', 'thickness'] as const).forEach(num);
  if (r.shape === 'oval' || r.shape === 'rect' || r.shape === 'custom') p.shape = r.shape;
  if (r.split === 0 || r.split === 1 || r.split === 2 || r.split === 4 || r.split === 8) p.split = r.split;
  if (Array.isArray(r.customPoints)) {
    const pts = r.customPoints
      .filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((c) => Number.isFinite(Number(c))))
      .map(([u, v]) => [Number(u), Number(v)] as [number, number]);
    if (pts.length >= 1 && pts.length <= 12) p.customPoints = pts;
  }
  p.perRev = Math.max(1, Math.round(p.perRev));
  return p;
}

export function loadParams(): Params {
  try {
    const hash = location.hash.slice(1);
    if (hash.startsWith('p=')) return sanitize(JSON.parse(decodeURIComponent(hash.slice(2))));
  } catch { /* битая ссылка — игнорируем */ }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return sanitize(JSON.parse(s));
  } catch { /* нет доступа к storage */ }
  return structuredClone(DEFAULT_PARAMS);
}

export function saveParams(p: Params): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

export function shareUrl(p: Params): string {
  const url = new URL(location.href);
  url.hash = 'p=' + encodeURIComponent(JSON.stringify(p));
  return url.toString();
}
