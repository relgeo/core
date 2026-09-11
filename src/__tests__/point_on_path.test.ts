import { describe, it, expect } from 'vitest';
import { resolveGeometry } from '../resolver';
import { parseRelGeo } from '../parser';
import { ResolvedPoint } from '../types';

describe('Point on Path/Polygon Resolution', () => {
  it('should resolve point on a circle', () => {
    const yaml = `
version: 0.3
objects:
  c1:
    type: circle
    center: [100, 100]
    radius: 50
  p1:
    type: point
    on: { path: { path: c1, t: 0 } }
  p2:
    type: point
    on: { path: { path: c1, t: 0.25 } }
`;
    const doc = parseRelGeo(yaml);
    const result = resolveGeometry(doc);
    expect((result.objects.p1 as ResolvedPoint).x).toBeCloseTo(150);
    expect((result.objects.p1 as ResolvedPoint).y).toBeCloseTo(100);
    expect((result.objects.p2 as ResolvedPoint).x).toBeCloseTo(100);
    expect((result.objects.p2 as ResolvedPoint).y).toBeCloseTo(150);
  });

  it('should resolve point on a rect', () => {
    const yaml = `
version: 0.3
objects:
  r1:
    type: rect
    place: { left: 0, top: 0 }
    size: [100, 50]
  p1:
    type: point
    on: { path: { path: r1, t: 0.25 } }
`;
    const doc = parseRelGeo(yaml);
    const result = resolveGeometry(doc);
    expect((result.objects.p1 as ResolvedPoint).x).toBeCloseTo(75);
    expect((result.objects.p1 as ResolvedPoint).y).toBeCloseTo(0);
  });

  it('should resolve point on a path with curves', () => {
    const yaml = `
version: 0.3
objects:
  path1:
    type: path
    segments:
      - line: { from: [0, 0], to: [100, 0] }
      - line: { to: [100, 100] }
  p1:
    type: point
    on: { path: { path: path1, t: 0.25 } }
  p2:
    type: point
    on: { path: { path: path1, t: 0.75 } }
`;
    const doc = parseRelGeo(yaml);
    const result = resolveGeometry(doc);
    expect((result.objects.p1 as ResolvedPoint).x).toBeCloseTo(50);
    expect((result.objects.p1 as ResolvedPoint).y).toBeCloseTo(0);
    expect((result.objects.p2 as ResolvedPoint).x).toBeCloseTo(100);
    expect((result.objects.p2 as ResolvedPoint).y).toBeCloseTo(50);
  });

  it('should resolve point on a quadratic curve', () => {
    const yaml = `
version: 0.3
objects:
  q1:
    type: quadratic
    from: [100, 0]
    cp: [150, 50]
    to: [100, 100]
  p_on:
    type: point
    on: { path: { path: q1, t: 0.5 } }
`;
    const doc = parseRelGeo(yaml);
    const result = resolveGeometry(doc);
    expect((result.objects.p_on as ResolvedPoint).x).toBeCloseTo(125);
    expect((result.objects.p_on as ResolvedPoint).y).toBeCloseTo(50);
  });
});
