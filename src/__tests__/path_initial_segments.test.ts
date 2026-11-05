import { describe, expect, it } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument, ResolvedPath } from "../types";

const points = {
  A: { type: "point" as const, at: [0, 0] as [number, number] },
  B: { type: "point" as const, at: [10, 0] as [number, number] },
  C: { type: "point" as const, at: [15, 5] as [number, number] },
  D: { type: "point" as const, at: [20, 0] as [number, number] },
  E: { type: "point" as const, at: [25, 5] as [number, number] },
  F: { type: "point" as const, at: [30, 5] as [number, number] },
  G: { type: "point" as const, at: [35, 0] as [number, number] },
};

function resolveSegments(segments: any[]): ResolvedPath {
  const doc: RelGeoDocument = { version: 0.3, objects: { ...points, shape: { type: "path", segments } } };
  return resolveGeometry(doc).objects.shape as ResolvedPath;
}

describe("path segment initial-point generalization", () => {
  it.each([
    ["line", [{ line: { from: "A", to: "B" } }, { quadratic: { cp: "C", to: "D" } }]],
    ["arc", [{ arc: { from: "A", through: "C", to: "D" } }, { line: { to: "E" } }]],
    ["quadratic", [{ quadratic: { from: "A", cp: "B", to: "D" } }, { cubic: { cp1: "E", cp2: "F", to: "G" } }]],
    ["cubic", [{ cubic: { from: "A", cp1: "B", cp2: "C", to: "D" } }, { quadratic: { cp: "E", to: "G" } }]],
  ])("accepts %s as the initial segment and chains its endpoint", (_kind, segments) => {
    const shape = resolveSegments(segments);
    expect(shape.segments).toHaveLength(2);
    expect(shape.segments?.[0].x1).toBe(0);
    expect(shape.segments?.[0].y1).toBe(0);
    expect(shape.segments?.[1].x1).toBe(shape.segments?.[0].x2);
    expect(shape.segments?.[1].y1).toBe(shape.segments?.[0].y2);
  });

  it("requires from on the first segment for every segment type", () => {
    for (const [segment, type] of [
      { line: { to: "A" } },
      { arc: { through: "B", to: "C" } },
      { quadratic: { cp: "B", to: "C" } },
      { cubic: { cp1: "B", cp2: "C", to: "D" } },
    ].map((segment) => [segment, Object.keys(segment)[0]] as const)) {
      expect(() => resolveSegments([segment])).toThrowError(expect.objectContaining({
        code: "MISSING_REQUIRED_FIELD",
        path: `objects.shape.segments[0].${type}.from`,
      }));
    }
  });

  it("rejects from on every continuation type with a nested diagnostic path", () => {
    for (const [segment, type] of [
      { line: { from: "C", to: "D" } },
      { arc: { from: "C", through: "D", to: "E" } },
      { quadratic: { from: "C", cp: "D", to: "E" } },
      { cubic: { from: "C", cp1: "D", cp2: "E", to: "F" } },
    ].map((segment) => [segment, Object.keys(segment)[0]] as const)) {
      expect(() => resolveSegments([{ line: { from: "A", to: "B" } }, segment])).toThrowError(
        expect.objectContaining({
          code: "UNKNOWN_FIELD",
          path: `objects.shape.segments[1].${type}.from`,
        })
      );
    }
  });

  it("rejects unknown fields on a segment", () => {
    expect(() => parseRelGeo(`
version: 0.3
objects:
  shape:
    type: path
    segments:
      - line:
          from: [0, 0]
          to: [10, 0]
          typo: [20, 0]
    `, { mode: "validate" })).toThrowError(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("resolves relative line segments with deterministic heading and turn", () => {
    const shape = resolveSegments([
      { line: { from: "A", direction: "right", forward: 10 } },
      { line: { turn: "90deg", forward: 5 } },
      { line: { direction: "up-right", forward: 10 } },
    ]);

    expect(shape.segments).toHaveLength(3);
    expect(shape.segments?.[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(shape.segments?.[1]?.x2).toBeCloseTo(10);
    expect(shape.segments?.[1]?.y2).toBeCloseTo(5);
    expect(shape.segments?.[2]?.x2).toBeCloseTo(10 + Math.sqrt(50));
    expect(shape.segments?.[2]?.y2).toBeCloseTo(5 - Math.sqrt(50));
  });

  it("rejects relative line boundary violations with specific diagnostics", () => {
    expect(() => parseRelGeo(`
version: 0.5
objects:
  shape:
    type: path
    segments:
      - line:
          from: [0, 0]
          turn: 90deg
          forward: 5
`, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "TURTLE_HEADING_UNAVAILABLE",
      path: "objects.shape.segments[0].line.turn",
    }));

    expect(() => parseRelGeo(`
version: 0.5
objects:
  shape:
    type: path
    segments:
      - line:
          from: [0, 0]
          direction: right
          forward: 0
`, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "INVALID_TURTLE_FORWARD",
      path: "objects.shape.segments[0].line.forward",
    }));

    expect(() => resolveSegments([
      { line: { from: "A", direction: "right", forward: 10 } },
      { line: { turn: Number.NaN, forward: 5 } },
    ])).toThrowError(expect.objectContaining({
      code: "INVALID_TURTLE_TURN",
      path: "objects.shape.segments[1].line.turn",
    }));
  });
});
