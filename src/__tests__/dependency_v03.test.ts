import { describe, it, expect } from "vitest";
import { sortObjects } from "../graph";

describe("Dependency Ordering v0.3", () => {
  it("should correctly order arc defined before its point references", () => {
    const objects: any = {
      arc1: {
        type: "arc",
        from: "A",
        through: "B",
        to: "C"
      },
      A: { type: "point", at: [0, 0] },
      B: { type: "point", at: [5, 5] },
      C: { type: "point", at: [10, 0] }
    };
    
    const sorted = sortObjects(objects);
    
    // A, B, C must come before arc1
    expect(sorted.indexOf("A")).toBeLessThan(sorted.indexOf("arc1"));
    expect(sorted.indexOf("B")).toBeLessThan(sorted.indexOf("arc1"));
    expect(sorted.indexOf("C")).toBeLessThan(sorted.indexOf("arc1"));
  });

  it("should handle path segments and holes dependencies", () => {
    const objects: any = {
      p1: {
        type: "path",
        closed: true,
        segments: [
          { line: { from: "P1", to: "P2" } }
        ],
        holes: [
          { segments: [ { line: { from: "H1", to: "H2" } } ] }
        ]
      },
      P1: { type: "point", at: [0,0] },
      P2: { type: "point", at: [10,0] },
      H1: { type: "point", at: [2,2] },
      H2: { type: "point", at: [3,3] }
    };
    
    const sorted = sortObjects(objects);
    expect(sorted.indexOf("P1")).toBeLessThan(sorted.indexOf("p1"));
    expect(sorted.indexOf("P2")).toBeLessThan(sorted.indexOf("p1"));
    expect(sorted.indexOf("H1")).toBeLessThan(sorted.indexOf("p1"));
    expect(sorted.indexOf("H2")).toBeLessThan(sorted.indexOf("p1"));
  });

  it("orders explicit curve segment endpoints and hole controls before their path", () => {
    const objects: any = {
      shape: {
        type: "path",
        segments: [
          { cubic: { from: "A", cp1: "B", cp2: "C", to: "D" } },
        ],
        holes: [
          {
            segments: [
              { quadratic: { from: "E", cp: "F", to: "G" } },
            ],
          },
        ],
      },
      A: { type: "point", at: [0, 0] },
      B: { type: "point", at: [2, 4] },
      C: { type: "point", at: [8, 4] },
      D: { type: "point", at: [10, 0] },
      E: { type: "point", at: [3, 1] },
      F: { type: "point", at: [4, 2] },
      G: { type: "point", at: [5, 1] },
    };

    const sorted = sortObjects(objects);
    for (const dependency of ["A", "B", "C", "D", "E", "F", "G"]) {
      expect(sorted.indexOf(dependency)).toBeLessThan(sorted.indexOf("shape"));
    }
  });

  it("should canonicalize cycle diagnostics independent of declaration order", () => {
    const firstOrder: any = {
      A: { type: "point", at: "B" },
      B: { type: "point", at: "A" },
    };
    const secondOrder: any = {
      B: { type: "point", at: "A" },
      A: { type: "point", at: "B" },
    };

    expect(() => sortObjects(firstOrder)).toThrow("Circular dependency detected: A -> B -> A");
    expect(() => sortObjects(secondOrder)).toThrow("Circular dependency detected: A -> B -> A");
  });
});
