import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";

describe("v0.4 Parameter Type Validation", () => {
  it("should NOT throw in editor mode even with invalid parameter types", () => {
    const yaml = `
version: 0.4
parameters:
  width:
    type: length
    default: true
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "editor" })).not.toThrow();
  });

  it("should reject invalid parameter type name in validate mode", () => {
    const yaml = `
version: 0.4
parameters:
  myParam:
    type: super-cool-type
    default: 10
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("Unknown parameter type: \"super-cool-type\"");
  });

  it("should reject boolean parameter with number default", () => {
    const yaml = `
version: 0.4
parameters:
  isActive:
    type: boolean
    default: 42
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("Value must be a boolean");
  });

  it("should accept valid boolean defaults", () => {
    const yaml = `
version: 0.4
parameters:
  isActive:
    type: boolean
    default: false
  isEnabled:
    type: boolean
    default: "true"
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should reject invalid length formats", () => {
    const yaml = `
version: 0.4
parameters:
  spacing:
    type: length
    default: "10abc"
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("Value must be a valid length");
  });

  it("should accept valid length formats", () => {
    const yaml = `
version: 0.4
parameters:
  spacing:
    type: length
    default: "15mm"
  margin:
    type: length
    default: 20
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should accept inch length literals and reject malformed numeric literals", () => {
    const validYaml = `
version: 0.5
parameters:
  spacing:
    type: length
    default: "1in"
objects: {}
`;
    expect(() => parseRelGeo(validYaml, { mode: "validate" })).not.toThrow();

    const malformedYaml = `
version: 0.5
parameters:
  spacing:
    type: length
    default: "10..5mm"
objects: {}
`;
    expect(() => parseRelGeo(malformedYaml, { mode: "validate" })).toThrow("Value must be a valid length");
  });

  it("should reject invalid angle formats", () => {
    const yaml = `
version: 0.4
parameters:
  rotation:
    type: angle
    default: "90px"
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("Value must be a valid angle");
  });

  it("should accept valid angle formats", () => {
    const yaml = `
version: 0.4
parameters:
  rotation:
    type: angle
    default: "1.5rad"
  tilt:
    type: angle
    default: 45
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should reject malformed numeric, angle, and percentage literals without truncation", () => {
    for (const [type, value] of [
      ["number", "10mm"],
      ["number", "10abc"],
      ["angle", "10..5deg"],
      ["percent", "10..5%"],
    ] as const) {
      const yaml = `
version: 0.5
parameters:
  value:
    type: ${type}
    default: ${value}
objects: {}
`;
      expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
        code: "TYPE_MISMATCH",
        path: "parameters.value.default",
      }));
    }
  });

  it("accepts exponent-form numeric and length defaults", () => {
    const yaml = `
version: 0.5
parameters:
  count:
    type: number
    default: 1e2
  spacing:
    type: length
    default: 1e2mm
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should reject invalid point structures", () => {
    const yaml = `
version: 0.4
parameters:
  startPos:
    type: point
    default: [10, "20abc"]
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("Coordinate at index 1 must be a valid length");
  });

  it("should accept valid point structures", () => {
    const yaml = `
version: 0.4
parameters:
  startPos:
    type: point
    default: ["10mm", "20cm"]
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should accept inch point coordinates", () => {
    const yaml = `
version: 0.5
parameters:
  origin:
    type: point
    default: ["1in", "2in"]
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should reject profile overrides with an incompatible declared type", () => {
    const yaml = `
version: 0.5
parameters:
  width:
    type: length
    default: 10mm
profiles:
  compact:
    width: true
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      path: "profiles.compact.width",
    }));
  });

  it("should reject profile overrides for undeclared parameters", () => {
    const yaml = `
version: 0.5
parameters:
  width:
    type: length
    default: 10mm
profiles:
  compact:
    height: 20mm
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_FIELD",
      path: "profiles.compact.height",
    }));
  });

  it("should reject profile overrides for constants", () => {
    const yaml = `
version: 0.5
parameters:
  width:
    type: length
    default: 10mm
constants:
  gap: 2mm
profiles:
  compact:
    gap: 1mm
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "UNKNOWN_FIELD",
      path: "profiles.compact.gap",
    }));
  });

  it("should reject a profile whose override map is not an object", () => {
    const yaml = `
version: 0.5
parameters:
  width:
    type: length
    default: 10mm
profiles:
  compact: [20mm]
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
      code: "TYPE_MISMATCH",
      path: "profiles.compact",
    }));
  });

  it("should continue accepting valid typed profile overrides", () => {
    const yaml = `
version: 0.5
parameters:
  width:
    type: length
    default: 10mm
  rotation:
    type: angle
    default: 0deg
profiles:
  compact:
    width: 20mm
    rotation: 1.5rad
objects: {}
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("enforces the v0.5 structured type shapes", () => {
    const validYaml = `
version: 0.5
parameters:
  frame:
    type: frame2d
    default:
      point: [10mm, 20mm]
      angle: 90deg
      tangent: [1, 0]
      normal: [0, 1]
  bounds:
    type: bbox2d
    default:
      minX: 0
      maxX: 20mm
      minY: 0
      maxY: 10mm
      width: 20mm
      height: 10mm
  items:
    type: collection
    default:
      type: collection
      children: [first, second]
  path:
    type: path-ref
    default: outline
objects: {}
`;
    expect(() => parseRelGeo(validYaml, { mode: "validate" })).not.toThrow();

    const invalidCases = [
      ["frame2d", "point: [10mm]\n      angle: 0deg"],
      ["bbox2d", "minX: 0\n      maxX: 10\n      minY: 0\n      maxY: 10\n      width: 10"],
      ["collection", "type: collection"],
      ["path-ref", "[outline]"],
    ] as const;

    for (const [type, value] of invalidCases) {
      const yaml = `
version: 0.5
parameters:
  value:
    type: ${type}
    default:
      ${value}
objects: {}
`;
      expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrowError(expect.objectContaining({
        code: expect.any(String),
        path: expect.stringMatching(/^parameters\.value(?:\.|$)/),
      }));
    }
  });
});
