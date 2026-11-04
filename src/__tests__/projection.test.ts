import { describe, expect, it } from "vitest";
import {
  compareResolvedSceneReplay,
  parseRelGeo,
  projectResolvedScene,
  resolveGeometry,
  serializeResolvedScene,
} from "../index";

describe("canonical resolved-scene projection", () => {
  it("publishes stable schema, explicit order, and normalized semantic fields", () => {
    const scene = resolveGeometry(parseRelGeo(`version: 0.5
parameters:
  width:
    type: length
    default: 10px
objects:
  z:
    type: point
    at: [width, 2]
  a:
    type: point
    at: [0, 0]
`));

    const projection = projectResolvedScene(scene);
    expect(projection.schema).toBe("relgeo.resolved-scene");
    expect(projection.schemaVersion).toBe(1);
    expect(projection.compatibilityLine).toBe("0.5");
    expect(projection.objectOrder).toEqual(["z", "a"]);
    expect(Object.keys(projection.objects)).toEqual(["a", "z"]);
    expect(projection.values.width).toBe(10);
    expect(projection.violations).toEqual([]);
  });

  it("serializes identical semantic output identically on repeated calls", () => {
    const scene = resolveGeometry(parseRelGeo(`version: 0.5
objects:
  point:
    type: point
    at: [0, 0]
`));

    expect(serializeResolvedScene(scene)).toBe(serializeResolvedScene(scene));
  });

  it("canonicalizes numeric noise while preserving semantic array order", () => {
    const comparison = compareResolvedSceneReplay(
      JSON.stringify({ b: 1.23456789012345, a: -0, nested: { z: undefined, a: 2 } }),
      JSON.stringify({ nested: { a: 2 }, a: 0, b: 1.234567890123 }),
    );

    expect(comparison.equal).toBe(true);
    expect(comparison.expected).toBe('{"a":0,"b":1.234567890123,"nested":{"a":2}}');
  });

  it("detects semantic replay changes even when map key order is different", () => {
    const scene = resolveGeometry(parseRelGeo(`version: 0.5
objects:
  first:
    type: point
    at: [0, 0]
  second:
    type: point
    at: [1, 1]
`));
    const projection = projectResolvedScene(scene);
    const reordered = { ...projection, objectOrder: [...projection.objectOrder].reverse() };

    expect(compareResolvedSceneReplay(projection, reordered).equal).toBe(false);
    expect(compareResolvedSceneReplay(projection, JSON.stringify(projection)).equal).toBe(true);
  });
});
