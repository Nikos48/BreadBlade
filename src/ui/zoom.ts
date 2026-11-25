/** Колесо — зум к курсору, перетаскивание — сдвиг, двойной клик — исходный вид. */
export function makeZoomable(svg: SVGSVGElement) {
  const vb0 = svg.viewBox.baseVal;
  const init = { x: vb0.x, y: vb0.y, w: vb0.width, h: vb0.height };
  let vb = { ...init };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const toSvg = (cx: number, cy: number) => {
    const p = svg.createSVGPoint();
    p.x = cx; p.y = cy;
    const m = svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : p;
  };
  svg.style.cursor = 'grab';
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0015);
    const nw = Math.min(init.w * 1.5, Math.max(init.w / 60, vb.w * f));
    const k = nw / vb.w;
    const p = toSvg(e.clientX, e.clientY);
    vb = { x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: vb.w * k, h: vb.h * k };
    apply();
  }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = toSvg(e.clientX, e.clientY);
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY);
    vb.x += drag.x - p.x;
    vb.y += drag.y - p.y;
    apply();
  });
  const end = () => { drag = null; svg.style.cursor = 'grab'; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', () => { vb = { ...init }; apply(); });
}
