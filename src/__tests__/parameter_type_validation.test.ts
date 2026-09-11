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
});
