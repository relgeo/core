import { describe, it, expect } from "vitest";
import { Validator } from "../validator";

describe("Validator v0.3", () => {
  it("should allow line with tangent mode but no root from", () => {
    const doc: any = {
      version: "0.3",
      objects: {
        circle1: { type: "circle", center: [0, 0], radius: 10 },
        A: { type: "point", at: [20, 20] },
        T: {
          type: "line",
          tangent: {
            from: "A",
            to: "circle1",
            pick: "first"
          }
        }
      }
    };
    
    const validator = new Validator(doc);
    expect(() => validator.validate()).not.toThrow();
  });

  it("should still require from for normal line", () => {
    const doc: any = {
      version: "0.3",
      objects: {
        L: {
          type: "line",
          to: [10, 10]
        }
      }
    };
    
    const validator = new Validator(doc);
    expect(() => validator.validate()).toThrow(/requires "from"/);
  });
});
