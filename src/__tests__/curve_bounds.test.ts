import { describe, expect, it } from "vitest";
import { resolveGeometry } from "../resolver";
import { curveEnvelopeFixture } from "./curve_bounds.fixture";

describe("curve envelope contract", () => {
  it("uses the quadratic curve envelope, not its control polygon, for placement", () => {
    const scene = resolveGeometry(curveEnvelopeFixture.quadratic as any);

    const curve = scene.objects.curve as any;
    const marker = scene.objects.marker as any;

    // The quadratic reaches y=50 at t=0.5; its control point at y=100 is not
    // part of the rendered curve and must not expand the placement bbox.
    expect(curve.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(curve.points[curve.points.length - 1]).toMatchObject({ x: 100, y: 0 });
    expect(marker.x).toBeCloseTo(45);
    expect(marker.y).toBeCloseTo(20);
  });

  it("uses cubic derivative extrema instead of control points", () => {
    const scene = resolveGeometry(curveEnvelopeFixture.cubic as any);

    const curve = scene.objects.curve as any;
    expect(curve.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(curve.points[curve.points.length - 1]).toMatchObject({ x: 100, y: 0 });
    expect((scene.objects.marker as any).x).toBeCloseTo(45);
    expect((scene.objects.marker as any).y).toBeCloseTo(32.5);
  });
});
