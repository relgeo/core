export type CurvePoint = { x: number; y: number };

const ROOT_EPSILON = 1e-12;

function pushInteriorRoot(target: number[], value: number): void {
  if (value > ROOT_EPSILON && value < 1 - ROOT_EPSILON && Number.isFinite(value)) {
    target.push(value);
  }
}

function coordinateAtQuadratic(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function coordinateAtCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0
    + 3 * mt * mt * t * p1
    + 3 * mt * t * t * p2
    + t * t * t * p3;
}

function quadraticExtrema(p0: number, p1: number, p2: number): number[] {
  const denominator = p0 - 2 * p1 + p2;
  if (Math.abs(denominator) <= ROOT_EPSILON) return [];
  const roots: number[] = [];
  pushInteriorRoot(roots, (p0 - p1) / denominator);
  return roots;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // After dividing the derivative by three, d/dt B(t) = at² + 2bt + c,
  // where B(t) is the cubic Bezier coordinate.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = p0 - 2 * p1 + p2;
  const c = p1 - p0;
  const A = a;
  const B = 2 * b;

  if (Math.abs(A) <= ROOT_EPSILON) {
    const roots: number[] = [];
    if (Math.abs(B) > ROOT_EPSILON) pushInteriorRoot(roots, -c / B);
    return roots;
  }

  const discriminant = B * B - 4 * A * c;
  if (discriminant < -ROOT_EPSILON) return [];
  if (Math.abs(discriminant) <= ROOT_EPSILON) {
    const roots: number[] = [];
    pushInteriorRoot(roots, -B / (2 * A));
    return roots;
  }

  const root = Math.sqrt(discriminant);
  const roots: number[] = [];
  pushInteriorRoot(roots, (-B - root) / (2 * A));
  pushInteriorRoot(roots, (-B + root) / (2 * A));
  return roots;
}

/**
 * Returns endpoints plus all interior derivative roots for a curve segment.
 * Control points are intentionally excluded: they are not necessarily on the
 * curve and therefore must not expand a path's semantic bounding box.
 */
export function curveEnvelopePoints(segment: any): CurvePoint[] {
  const points: CurvePoint[] = [
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 },
  ];

  if (segment.type === "quadratic") {
    const roots = [
      ...quadraticExtrema(segment.x1, segment.cpx, segment.x2),
      ...quadraticExtrema(segment.y1, segment.cpy, segment.y2),
    ];
    for (const t of roots) {
      points.push({
        x: coordinateAtQuadratic(segment.x1, segment.cpx, segment.x2, t),
        y: coordinateAtQuadratic(segment.y1, segment.cpy, segment.y2, t),
      });
    }
    return points;
  }

  if (segment.type === "cubic") {
    const roots = [
      ...cubicExtrema(segment.x1, segment.cp1x, segment.cp2x, segment.x2),
      ...cubicExtrema(segment.y1, segment.cp1y, segment.cp2y, segment.y2),
    ];
    for (const t of roots) {
      points.push({
        x: coordinateAtCubic(segment.x1, segment.cp1x, segment.cp2x, segment.x2, t),
        y: coordinateAtCubic(segment.y1, segment.cp1y, segment.cp2y, segment.y2, t),
      });
    }
  }

  return points;
}

export function addCurveEnvelopePoints(target: CurvePoint[], segment: any): void {
  target.push(...curveEnvelopePoints(segment));
}
