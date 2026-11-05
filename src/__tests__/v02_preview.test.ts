import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import type { RelGeoDocument } from "../types";

describe("RelGeo v0.2 Preview Features", () => {
  it("should resolve polar movement", () => {
    const doc: RelGeoDocument = {
      version: "0.2",
      objects: {
        p1: { type: "point", at: "origin" },
        p2: { 
          type: "point", 
          from: "p1", 
          move: { angle: "45deg", distance: "100" } 
        }
      }
    };

    const scene = resolveGeometry(doc);
    const p2 = scene.objects.p2 as any;
    
    // 45deg distance 100 => x = 100 * cos(45), y = 100 * sin(45)
    // cos(45) = sin(45) = 0.7071
    expect(p2.x).toBeCloseTo(70.71, 1);
    expect(p2.y).toBeCloseTo(70.71, 1);
  });

  it("should resolve custom anchors", () => {
    const doc: RelGeoDocument = {
      version: "0.2",
      objects: {
        r1: { 
          type: "rect", 
          size: [100, 100], 
          place: { left: 0, top: 0 },
          anchors: {
            pivot: ["20%", "80%"],
            custom: [10, 20]
          }
        },
        p1: { type: "point", at: "r1.pivot" },
        p2: { type: "point", at: "r1.custom" }
      }
    };

    const scene = resolveGeometry(doc);
    const p1 = scene.objects.p1 as any;
    const p2 = scene.objects.p2 as any;

    expect(p1.x).toBe(20);
    expect(p1.y).toBe(80);
    expect(p2.x).toBe(10);
    expect(p2.y).toBe(20);
  });

  it("should resolve line-line intersection", () => {
    const doc: RelGeoDocument = {
      version: "0.2",
      objects: {
        l1: { type: "line", from: [0, 0] as any, to: [100, 100] as any },
        l2: { type: "line", from: [0, 100] as any, to: [100, 0] as any },
        inter: { type: "point", at: "intersection(l1, l2)" }
      }
    };

    const scene = resolveGeometry(doc);
    const inter = scene.objects.inter as any;

    expect(inter.x).toBe(50);
    expect(inter.y).toBe(50);
  });

  it("should resolve basic text", () => {
    const doc: RelGeoDocument = {
      version: "0.2",
      objects: {
        t1: { type: "text", at: [50, 60] as any, content: "Hello" }
      }
    };

    const scene = resolveGeometry(doc);
    const t1 = scene.objects.t1 as any;

    expect(t1.type).toBe("text");
    expect(t1.x).toBe(50);
    expect(t1.y).toBe(60);
    expect(t1.width).toBeGreaterThan(0);
    expect(t1.height).toBeGreaterThan(0);
    expect(t1.content).toBe("Hello");
  });

  it("uses the normative center default for text in RelGeo 0.5", () => {
    const scene = resolveGeometry({
      version: "0.5",
      objects: {
        label: { type: "text", at: [50, 60] as any, content: "Hello" }
      }
    });

    const label = scene.objects.label as any;
    expect(label.anchor).toBe("center");
    expect(label.x).toBeCloseTo(32);
    expect(label.y).toBeCloseTo(54);
  });

  it("should resolve text anchor placement from point", () => {
    const doc: RelGeoDocument = {
      version: "0.3",
      objects: {
        t1: { type: "text", at: [100, 40] as any, content: "Hello", anchor: "topCenter" }
      }
    };

    const scene = resolveGeometry(doc);
    const t1 = scene.objects.t1 as any;

    expect(t1.x).toBe(82);
    expect(t1.y).toBe(40);
    expect(t1.width).toBe(36);
    expect(t1.height).toBe(12);
  });

  it("should expose 9-point text anchors from resolved bounding box", () => {
    const doc: RelGeoDocument = {
      version: "0.3",
      objects: {
        t1: { type: "text", at: [50, 60] as any, content: "Hello", anchor: "topLeft" },
        p1: { type: "point", at: "t1.bottomCenter" }
      }
    };

    const scene = resolveGeometry(doc);
    const p1 = scene.objects.p1 as any;

    expect(p1.x).toBe(68);
    expect(p1.y).toBe(72);
  });

  it("should resolve basic path", () => {
    const doc: RelGeoDocument = {
      version: "0.2",
      objects: {
        p1: { type: "point", at: [0, 0] as any },
        p2: { type: "point", at: [100, 0] as any },
        p3: { type: "point", at: [50, 100] as any },
        triangle: { type: "path", points: ["p1", "p2", "p3", "p1"] }
      }
    };

    const scene = resolveGeometry(doc);
    const path = scene.objects.triangle as any;

    expect(path.points).toHaveLength(4);
    expect(path.points[0]).toEqual({ x: 0, y: 0 });
    expect(path.points[2]).toEqual({ x: 50, y: 100 });
  });
});
