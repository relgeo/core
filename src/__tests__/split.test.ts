import { describe, expect, it } from "vitest";
import { parseRelGeo, resolveGeometry, Validator } from "..";

describe("split object", () => {
  it("parses split objects in the active syntax surface", () => {
    const doc = parseRelGeo(`
version: 0.5
objects:
  A: { type: point, at: [0, 0] }
  B: { type: point, at: [10, 0] }
  cut:
    type: split
    target: edge
    at: [4, 0]
  edge:
    type: line
    from: A
    to: B
`);

    expect(doc.objects.cut.type).toBe("split");
  });

  it("validates pick as first/last only", () => {
    const doc = {
      version: 0.5,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        edge: { type: "line", from: "A", to: "B" },
        cut: { type: "split", target: "edge", at: [4, 0], pick: "middle" as any },
      },
    } as any;

    expect(() => new Validator(doc, "validate").validate()).toThrow("INVALID_VALUE");
  });

  it("resolves split without pick as a collection of two path pieces", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        edge: { type: "line", from: "A", to: "B" },
        cut: { type: "split", target: "edge", at: [4, 0] },
      },
    } as any);

    const cut = resolved.objects.cut as any;
    expect(cut.type).toBe("collection");
    expect(cut.children).toEqual(["cut[0]", "cut[1]"]);
    expect((resolved.objects["cut[0]"] as any).type).toBe("path");
    expect((resolved.objects["cut[1]"] as any).type).toBe("path");
    expect((resolved.objects["cut[0]"] as any).segments[0]).toMatchObject({ x1: 0, y1: 0, x2: 4, y2: 0 });
    expect((resolved.objects["cut[1]"] as any).segments[0]).toMatchObject({ x1: 4, y1: 0, x2: 10, y2: 0 });
  });

  it("resolves split with pick as a single path result", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        edge: { type: "line", from: "A", to: "B" },
        head: { type: "split", target: "edge", at: [4, 0], pick: "first" },
      },
    } as any);

    const head = resolved.objects.head as any;
    expect(head.type).toBe("path");
    expect(head.segments[0]).toMatchObject({ x1: 0, y1: 0, x2: 4, y2: 0 });
  });

  it("supports first() and last() on default split collection", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      derived: {
        midX: "pointAt(first(cut), 1).x",
        tailStartX: "pointAt(last(cut), 0).x",
      },
      objects: {
        A: { type: "point", at: [0, 0] },
        B: { type: "point", at: [10, 0] },
        edge: { type: "line", from: "A", to: "B" },
        cut: { type: "split", target: "edge", at: [4, 0] },
      },
    } as any);

    expect((resolved.values as any).midX).toBeCloseTo(4);
    expect((resolved.values as any).tailStartX).toBeCloseTo(4);
  });

  it("rejects split at line start as DEGENERATE_SPLIT", () => {
    expect(() =>
      resolveGeometry({
        version: 0.5,
        objects: {
          A: { type: "point", at: [0, 0] },
          B: { type: "point", at: [10, 0] },
          edge: { type: "line", from: "A", to: "B" },
          cut: { type: "split", target: "edge", at: [0, 0] },
        },
      } as any)
    ).toThrow("DEGENERATE_SPLIT");
  });

  it("splits a path after a chained transform operation", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      objects: {
        edge: { type: "line", from: [0, 0], to: [10, 0] },
        shifted: { type: "translate", target: "edge", by: [5, 5] },
        turned: { type: "rotate", target: "shifted", angle: "90deg", origin: [0, 0] },
        cut: { type: "split", target: "turned", at: [-5, 10] },
      },
    } as any);

    const cut = resolved.objects.cut as any;
    expect(cut.type).toBe("collection");
    const first = (resolved.objects["cut[0]"] as any).segments[0];
    const last = (resolved.objects["cut[1]"] as any).segments[0];
    expect(first.x1).toBeCloseTo(-5);
    expect(first.y1).toBeCloseTo(5);
    expect(first.x2).toBeCloseTo(-5);
    expect(first.y2).toBeCloseTo(10);
    expect(last.x1).toBeCloseTo(-5);
    expect(last.y1).toBeCloseTo(10);
    expect(last.x2).toBeCloseTo(-5);
    expect(last.y2).toBeCloseTo(15);
  });

  it("preserves curve segment identity when splitting a quadratic", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      objects: {
        curve: {
          type: "quadratic",
          from: [0, 0],
          cp: [5, 10],
          to: [10, 0],
        },
        cut: { type: "split", target: "curve", at: [5, 5] },
      },
    } as any);

    const cut = resolved.objects.cut as any;
    expect(cut.type).toBe("collection");
    expect(cut.children).toEqual(["cut[0]", "cut[1]"]);
    expect((resolved.objects["cut[0]"] as any).segments[0].type).toBe("quadratic");
    expect((resolved.objects["cut[1]"] as any).segments[0].type).toBe("quadratic");
    expect((resolved.objects["cut[0]"] as any).segments[0]).toMatchObject({ x1: 0, y1: 0, x2: 5, y2: 5 });
    expect((resolved.objects["cut[1]"] as any).segments[0]).toMatchObject({ x1: 5, y1: 5, x2: 10, y2: 0 });
  });

  it("keeps result ordering when splitting a reversed and translated target", () => {
    const resolved = resolveGeometry({
      version: 0.5,
      objects: {
        base: { type: "line", from: [0, 0], to: [10, 0] },
        reversed: { type: "reverse", target: "base" },
        shifted: { type: "translate", target: "reversed", by: [5, 0] },
        cut: { type: "split", target: "shifted", at: [8, 0] },
      },
    } as any);

    const cut = resolved.objects.cut as any;
    expect(cut.children).toEqual(["cut[0]", "cut[1]"]);
    expect((resolved.objects["cut[0]"] as any).segments[0]).toMatchObject({ x1: 15, y1: 0, x2: 8, y2: 0 });
    expect((resolved.objects["cut[1]"] as any).segments[0]).toMatchObject({ x1: 8, y1: 0, x2: 5, y2: 0 });
  });
});
