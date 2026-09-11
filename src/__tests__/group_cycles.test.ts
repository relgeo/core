import { describe, it, expect } from "vitest";
import { parseRelGeo } from "../parser";
import { resolveGeometry } from "../resolver";

describe("Group Dependency Cycles (v0.2)", () => {
  it("should detect cycle when child depends on parent group anchor", () => {
    const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [C]
  C:
    type: rect
    size: [10, 10]
    place:
      left: G.left
      top: 0
`;
    // G depends on C (to calculate bbox for G.left)
    // C depends on G (to get G.left)
    // Result: G -> C -> G
    expect(() => {
        const doc = parseRelGeo(yaml, { mode: "validate" });
        resolveGeometry(doc);
    }).toThrow("Circular dependency");
  });

  it("should NOT have cycle when child depends on sibling", () => {
    const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [C1, C2]
  C1:
    type: rect
    size: [10, 10]
    place: { left: 0, top: 0 }
  C2:
    type: rect
    size: [10, 10]
    place: { left: C1.right, top: 0 }
`;
    expect(() => {
        const doc = parseRelGeo(yaml, { mode: "validate" });
        resolveGeometry(doc);
    }).not.toThrow();
  });
});
