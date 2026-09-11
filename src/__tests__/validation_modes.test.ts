import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";

describe("Validation Modes (v0.2)", () => {
  it("should NOT throw in editor mode for incomplete geometry", () => {
    const yaml = `
version: 0.2
objects:
  c:
    type: circle
`;
    expect(() => parseRelGeo(yaml, { mode: "editor" })).not.toThrow();
  });

  it("should throw in validate mode for incomplete geometry", () => {
    const yaml = `
version: 0.2
objects:
  c:
    type: circle
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("MISSING_REQUIRED_FIELD");
  });

  it("should reject circle with through + place in validate mode (Audit 6.3)", () => {
    const yaml = `
version: 0.2
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 10] }
  c:
    type: circle
    place: { center: A }
    through: B
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("UNSUPPORTED_FEATURE");
  });

  it("should reject text without content in validate mode (Audit 6.1)", () => {
    const yaml = `
version: 0.2
objects:
  t:
    type: text
    place: { center: [0, 0] }
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("MISSING_REQUIRED_FIELD");
  });

  it("should reject point.on with both line and segment in validate mode (Audit 6.2)", () => {
    const yaml = `
version: 0.2
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 10] }
  L: { type: line, from: A, to: B }
  P:
    type: point
    on:
      line: L
      segment: [A, B]
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("OVER_CONSTRAINED");
  });

  it("should reject invalid text anchor in validate mode", () => {
    const yaml = `
version: 0.3
objects:
  t:
    type: text
    at: origin
    content: Label
    anchor: baselineLeft
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("TYPE_MISMATCH");
  });

  it("should reject line that mixes tangent and to mode", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  c:
    type: circle
    center: A
    radius: 10
  l:
    type: line
    from: A
    to: B
    tangent:
      from: A
      to: c
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("OVER_CONSTRAINED");
  });

  it("should reject line tangent target that is not circle or arc", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  P:
    type: path
    points: [A, B]
  l:
    type: line
    from: A
    tangent:
      from: A
      to: P
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("TYPE_MISMATCH");
  });

  it("should reject tangent constraint without line-circle/arc pair", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  l1: { type: line, from: A, to: B }
  l2: { type: line, from: B, direction: right, length: 10 }
constraints:
  - tangent: [l1, l2]
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("TYPE_MISMATCH");
  });

  it("should reject path that mixes points and segments mode", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  C: { type: point, at: [10, 10] }
  p:
    type: path
    points: [A, B]
    segments:
      - line: { from: A, to: C }
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("OVER_CONSTRAINED");
  });

  it("should reject arc that mixes construction modes", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  C: { type: point, at: [10, 10] }
  arc1:
    type: arc
    from: A
    through: B
    to: C
    center: A
    radius: 10
    startAngle: 0deg
    endAngle: 90deg
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("OVER_CONSTRAINED");
  });

  it("should reject unavailable derived property access on primitive", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  p:
    type: path
    points: [A, B]
  marker:
    type: point
    at: ["p.area", 0]
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).toThrow("INVALID_EXPRESSION");
  });

  it("should accept nested point-like derived property access for cubic control point", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 20] }
  C: { type: point, at: [20, 20] }
  D: { type: point, at: [30, 0] }
  c1: { type: cubic, from: A, cp1: B, cp2: C, to: D }
  marker:
    type: point
    at: ["c1.cp1.x", "c1.cp2.y"]
    `;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });

  it("should allow offset from path with curved segments when the source can be flattened", () => {
    const yaml = `
version: 0.3
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 10] }
  C: { type: point, at: [20, 0] }
  source:
    type: path
    segments:
      - line: { from: A, to: A }
      - quadratic: { cp: B, to: C }
  outline:
    type: path
    offset:
      from: source
      distance: 5
`;
    expect(() => parseRelGeo(yaml, { mode: "validate" })).not.toThrow();
  });
});
