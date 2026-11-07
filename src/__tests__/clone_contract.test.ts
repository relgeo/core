import { describe, expect, it } from "vitest";
import { resolveGeometry } from "../resolver";

describe("clone identity and metadata contract", () => {
  it("keeps clone identity while projecting transformed inherited anchors", () => {
    const scene = resolveGeometry({
      version: 0.5,
      objects: {
        base: {
          type: "rect",
          size: [10, 10],
          place: { topLeft: [0, 0] },
          meta: { role: "source" },
        },
        copy: {
          type: "clone",
          of: "base",
          transform: [{ translate: [20, 0] }],
          meta: { role: "instance" },
        },
        marker: {
          type: "point",
          at: "copy.center",
        },
      },
    } as any);

    const copy = scene.objects.copy as any;
    const marker = scene.objects.marker as any;

    expect(copy).toMatchObject({
      id: "copy",
      type: "clone",
      of: "base",
      children: ["base"],
      meta: { role: "instance" },
    });
    expect(marker).toMatchObject({ x: 25, y: 5 });
  });
});
