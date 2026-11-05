import { describe, it, expect } from "vitest";
import { compileRelGeo } from "../resolver";

describe("v0.2 Final Verification", () => {
    it("should reject point.on.line with anchor ref (invalid type)", () => {
        const yaml = `
version: 0.2
objects:
  A: { type: rect, size: [100, 100], place: { left: 0, top: 0 } }
  P:
    type: point
    on:
      path:
        path: A.center
        t: 0.5
`;
        expect(() => compileRelGeo(yaml)).toThrow(/Unknown reference: A.center/);
    });

    it("should reject align.offset for point-like anchors", () => {
        const yaml = `
version: 0.2
objects:
  A:
    type: point
    at: [0, 0]
  B:
    type: point
    at: [10, 10]
constraints:
  - align:
      target: A
      with: B
      offset: 5
`;
        expect(() => compileRelGeo(yaml)).toThrow(/offset scalar is not allowed for point anchor in v0.2/);
    });

    it("should preserve child size in place.inside", () => {
        const yaml = `
version: 0.2
objects:
  parent:
    type: rect
    size: [100, 50]
    place: { left: 0, top: 0 }
  child:
    type: rect
    size: [20, 10]
    place:
      inside: parent
      margin: 5
`;
        const result = compileRelGeo(yaml);
        const child = result.objects.child as any;
        
        expect(child.width).toBe(20);
        expect(child.height).toBe(10);
        expect(child.x).toBe(5);
        expect(child.y).toBe(5);
    });

    it("should reject non-rect inside targets and negative margins", () => {
        const nonRectTarget = `
version: 0.2
objects:
  guide:
    type: line
    from: [0, 0]
    to: [100, 0]
  child:
    type: rect
    size: [20, 10]
    place: { inside: guide }
`;
        expect(() => compileRelGeo(nonRectTarget)).toThrow(/place\.inside target "guide" must be a rect/);

        const negativeMargin = `
version: 0.2
objects:
  parent:
    type: rect
    size: [100, 50]
    place: { left: 0, top: 0 }
  child:
    type: rect
    size: [20, 10]
    place:
      inside: parent
      margin: -1
`;
        expect(() => compileRelGeo(negativeMargin)).toThrow(/place\.inside margin must be a non-negative finite length/);
    });

    it("should support scalar align.offset with intuitive sign (target = with + offset)", () => {
        const yaml = `
version: 0.2
objects:
  A: { type: rect, size: [10, 10], place: { left: 0, top: 0 } }
  B: { type: rect, size: [10, 10], place: { left: 5, top: 0 } }
constraints:
  - align:
      target: B.left
      with: A.left
      offset: 5
`;
        const result = compileRelGeo(yaml);
        expect((result.objects.B as any).x).toBe(5);
    });

    it("should support width and height anchors for rect, circle, and group", () => {
        const yaml = `
version: 0.2
objects:
  R: { type: rect, size: [100, 50] }
  C: { type: circle, radius: 25, center: [0, 0] }
  G:
    type: group
    children: [R]
  test_rect:
    type: point
    at: [R.width, R.height]
  test_circle:
    type: point
    at: [C.width, C.height]
  test_group:
    type: point
    at: [G.width, G.height]
`;
        const result = compileRelGeo(yaml);
        expect((result.objects.test_rect as any).x).toBe(100);
        expect((result.objects.test_rect as any).y).toBe(50);
        expect((result.objects.test_circle as any).x).toBe(50);
        expect((result.objects.test_circle as any).y).toBe(50);
        expect((result.objects.test_group as any).x).toBe(100);
        expect((result.objects.test_group as any).y).toBe(50);
    });
});
