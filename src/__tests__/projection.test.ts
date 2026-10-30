import { describe, expect, it } from "vitest";
import { parseRelGeo, projectResolvedScene, resolveGeometry, serializeResolvedScene } from "../index";

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
});

