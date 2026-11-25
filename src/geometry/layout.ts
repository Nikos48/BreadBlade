import type { Params } from '../params';
import { buildContour, minCurvatureRadius, type Contour } from './contour';
import { developBlade, type Development } from './develop';

/**
 * Вся производная геометрия ролика.
 *
 * Ролик катится по тесту кромками лезвий, поэтому без проскальзывания
 * путь по тесту = R_tip · угол. Длина окружности по кромке = N · (длина лаваша + зазор).
 */
export interface Layout {
  params: Params;
  contour: Contour;
  /** шаг между лавашами по ходу прокатки */
  pitch: number;
  /** длина окружности по режущей кромке */
  circTip: number;
  rTip: number;
  /** радиус поверхности ролика */
  rSurface: number;
  /** радиус дна паза (нижняя кромка трафарета) */
  rRoot: number;
  cylLength: number;
  /** центры лавашей по x (в «развёрнутых» координатах прокатки) */
  centers: number[];
  development: Development;
  minBendRadius: number;
  warnings: string[];
}

export function computeLayout(params: Params): Layout {
  const contour = buildContour(params);
  const N = Math.max(1, Math.round(params.perRev));
  const pitch = 2 * contour.halfX + Math.max(0, params.gap);
  const circTip = N * pitch;
  const rTip = circTip / (2 * Math.PI);
  const rSurface = rTip - params.bladeHeight;
  const rRoot = rSurface - Math.max(0, params.embed);
  const cylLength = 2 * contour.halfY + 2 * Math.max(0, params.margin);
  const centers = Array.from({ length: N }, (_, j) => (j - (N - 1) / 2) * pitch);

  const warnings: string[] = [];
  if (rRoot <= 5) warnings.push('Лезвие выше радиуса ролика — увеличьте длину лаваша, число лавашей за оборот или уменьшите высоту лезвия.');
  else if (params.bladeHeight > rSurface * 0.35)
    warnings.push('Лезвие очень высокое относительно ролика: при гибке сталь будет сильно тянуться.');

  const minBendRadius = minCurvatureRadius(contour);
  if (minBendRadius < Math.max(2, params.thickness * 3))
    warnings.push(`Слишком крутой изгиб контура (R≈${minBendRadius.toFixed(1)} мм) для стали ${params.thickness} мм.`);
  if (params.gap < 1 && N >= 1)
    warnings.push('Без зазора соседние лаваши касаются — лезвия сольются в точке стыка.');

  const dev = (s: number) => developBlade(contour, rTip, Math.max(1, rRoot), rSurface, s);
  let development = dev(params.split || 1);
  if (params.split === 0)
    for (const s of [2, 4, 8]) {
      if (!development.overlaps) break;
      development = dev(s);
    }
  if (development.overlaps)
    warnings.push(params.split === 0
      ? 'Развёртка накладывается даже при 8 частях — проверьте форму контура.'
      : 'Развёртка накладывается сама на себя — увеличьте число частей (или выберите «Авто»).');

  return { params, contour, pitch, circTip, rTip, rSurface, rRoot, cylLength, centers, development, minBendRadius, warnings };
}
