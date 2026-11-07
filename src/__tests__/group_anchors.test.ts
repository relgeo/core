import { describe, it, expect } from "vitest";
import { resolveGeometry } from "../resolver";
import { parseRelGeo } from "../parser";
import { RelGeoDocument } from "../types";

describe("Group Anchors", () => {
    it("should resolve custom anchors on group objects", () => {
        const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [P]
    anchors:
      hook: [100, 100]
  P:
    type: point
    at: [10, 10]
  Q:
    type: point
    at: G.hook
`;
        const doc = parseRelGeo(yaml) as RelGeoDocument;
        const scene = resolveGeometry(doc);

        const G = scene.objects.G as any;
        const Q = scene.objects.Q as any;

        expect(G.anchors).toBeDefined();
        expect(G.anchors.hook).toEqual({ x: 110, y: 110 });
        expect(Q.x).toBe(110);
        expect(Q.y).toBe(110);
    });

    it("should apply group transformations to custom anchors when accessed externally", () => {
        const yaml = `
version: 0.2
objects:
  G:
    type: group
    children: [P]
    anchors:
      hook: [10, 0]
    transform:
      - translate: [100, 50]
      - rotate:
          angle: 90deg
          origin: [0, 0]
  P:
    type: point
    at: [0, 0]
  Q:
    type: point
    at: G.hook
`;
        const doc = parseRelGeo(yaml) as RelGeoDocument;
        const scene = resolveGeometry(doc);

        const Q = scene.objects.Q as any;

        // hook at [10, 0]
        // Rotate 90deg [10, 0] -> [0, 10]
        // Translate [100, 50] -> [100, 60]
        expect(Q.x).toBeCloseTo(100);
        expect(Q.y).toBeCloseTo(60);
    });

    it("composes nested group transformations for an external custom anchor", () => {
        const yaml = `
version: 0.2
objects:
  Outer:
    type: group
    children: [Inner]
    transform:
      - translate: [100, 0]
  Inner:
    type: group
    children: [P]
    anchors:
      hook: [10, 0]
    transform:
      - rotate:
          angle: 90deg
          origin: [0, 0]
  P:
    type: point
    at: [0, 0]
  Q:
    type: point
    at: Inner.hook
`;
        const doc = parseRelGeo(yaml) as RelGeoDocument;
        const scene = resolveGeometry(doc);
        const Q = scene.objects.Q as any;

        // Inner rotates [10, 0] to [0, 10], then Outer translates it.
        expect(Q.x).toBeCloseTo(100);
        expect(Q.y).toBeCloseTo(10);
    });
});
