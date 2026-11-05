import { describe, it, expect } from "vitest";
import {
  parseRelGeo,
  ParseError,
  ACTIVE_REL_GEO_SPEC_VERSION,
  classifyRelGeoSpecVersion,
} from "../parser";

describe("parser", () => {
  it("should parse a valid simple DSL", () => {
    const yaml = `
version: 0.1
objects:
  A:
    type: point
    at: origin
`;
    const doc = parseRelGeo(yaml);
    expect(doc.version).toBe(0.1);
    expect(doc.objects.A).toBeDefined();
    expect(doc.objects.A.id).toBe("A");
    expect(doc.objects.A.type).toBe("point");
  });

  it("should default missing version to the active runtime spec version", () => {
    const yaml = `
objects:
  A:
    type: point
    at: origin
`;
    const doc = parseRelGeo(yaml);
    expect(doc.version).toBe(ACTIVE_REL_GEO_SPEC_VERSION);
  });

  it("classifies active, supported legacy, and regression-only versions explicitly", () => {
    expect(classifyRelGeoSpecVersion("0.5")).toBe("active");
    expect(classifyRelGeoSpecVersion(0.4)).toBe("supported-legacy");
    expect(classifyRelGeoSpecVersion("0.2")).toBe("regression-only");
  });

  it.each(["0.6", "1.0", "0.5.1"])(
    "rejects unsupported version %s with an actionable parser diagnostic",
    (version) => {
      expect(() =>
        parseRelGeo(`version: "${version}"\nobjects: {}`),
      ).toThrowError(
        expect.objectContaining({
          path: "version",
          code: "UNSUPPORTED_SPEC_VERSION",
        }),
      );
      expect(() =>
        parseRelGeo(`version: "${version}"\nobjects: {}`),
      ).toThrow(`Unsupported RelGeo DSL version "${version}"`);
    },
  );

  it("should default missing objects to an empty object", () => {
    const yaml = `
version: 0.1
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects).toEqual({});
  });

  it("should throw ParseError on invalid YAML", () => {
    const yaml = `
version: 0.1
objects:
  A: : :
`;
    expect(() => parseRelGeo(yaml)).toThrow(ParseError);
    expect(() => parseRelGeo(yaml)).toThrow("YAML Parse Error");
  });

  it("rejects duplicate object identities instead of silently overwriting them", () => {
    const yaml = `
version: 0.5
objects:
  marker:
    type: point
    at: [0, 0]
  marker:
    type: point
    at: [10, 10]
`;

    expect(() => parseRelGeo(yaml)).toThrowError(expect.objectContaining({
      code: "INVALID_YAML",
      phase: "parse",
    }));
    expect(() => parseRelGeo(yaml)).toThrow(/duplicated mapping key/i);
  });

  it("should inject IDs into objects", () => {
    const yaml = `
version: 0.1
objects:
  box1:
    type: rect
    size: [10, 10]
    place: { left: 0, top: 0 }
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.box1.id).toBe("box1");
  });

  it("should accept metaPreset as the primary common object field", () => {
    const yaml = `
version: 0.5
metaPresets:
  guideLine:
    stroke: "#999"
    strokeWidth: 1
objects:
  centerLine:
    type: line
    from: [0, 0]
    to: [10, 0]
    metaPreset: guideLine
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.centerLine.metaPreset).toBe("guideLine");
  });

  it("should still accept style as a backward-compatibility alias", () => {
    const yaml = `
version: 0.5
styles:
  guideLine:
    stroke: "#999"
    strokeWidth: 1
objects:
  centerLine:
    type: line
    from: [0, 0]
    to: [10, 0]
    style: guideLine
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.centerLine.style).toBe("guideLine");
  });

  it("should throw on invalid object type", () => {
    const yaml = `
version: 0.1
objects:
  A:
    type: triangle
`;
    expect(() => parseRelGeo(yaml)).toThrow("Invalid object type: triangle");
  });

  it("should throw on unknown object field", () => {
    const yaml = `
version: 0.1
objects:
  A:
    type: point
    at: origin
    weird: 10
`;
    expect(() => parseRelGeo(yaml)).toThrow('Unknown field "weird" on object "A"');
  });

  it("should throw on dangling references", () => {
    const yaml = `
version: 0.1
objects:
  A:
    type: line
    from: B
    direction: right
    length: 10
`;
    expect(() => parseRelGeo(yaml, { strict: true })).toThrow("Unknown identifier: B");
  });

  it("should throw on unknown anchors", () => {
    const yaml = `
version: 0.1
objects:
  box:
    type: rect
    size: [10, 10]
    place: { left: 0, top: 0 }
  A:
    type: point
    at: box.middle
`;
    expect(() => parseRelGeo(yaml, { strict: true })).toThrow("Unknown anchor");
  });

  it("should throw on invalid expression syntax", () => {
    const yaml = `
version: 0.1
derived:
  width:
    value: 10cm ** 2
objects: {}
`;
    expect(() => parseRelGeo(yaml, { strict: true })).toThrow("Invalid expression syntax");
  });

  it("should accept v0.3 polygon syntax", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  C: { type: point, at: [10, 10] }
  poly:
    type: polygon
    points: [A, B, C]
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.poly.type).toBe("polygon");
  });

  it("should parse ellipse objects in active spec", () => {
    const yaml = `
version: 0.5
objects:
  oval:
    type: ellipse
    center: [10, 20]
    size: [80, 40]
    rotation: 0.5
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.oval.type).toBe("ellipse");
  });

  it("should reject ellipse size combined with rx/ry in strict mode", () => {
    const yaml = `
version: 0.5
objects:
  oval:
    type: ellipse
    center: [0, 0]
    size: [80, 40]
    rx: 40
    ry: 20
`;
    expect(() => parseRelGeo(yaml, { strict: true })).toThrow("ELLIPSE_SIZE_CONFLICT");
  });

  it("should accept v0.3 path segments syntax", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  C: { type: point, at: [10, 10] }
  shape:
    type: path
    segments:
      - line: { from: A, to: B }
      - arc: { through: C, to: A }
`;
    const doc = parseRelGeo(yaml);
    expect(doc.objects.shape.type).toBe("path");
  });
});
