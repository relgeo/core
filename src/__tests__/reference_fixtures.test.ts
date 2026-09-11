import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRelGeo, resolveGeometry } from "../index";

function loadFixture(name: string) {
  const filePath = fileURLToPath(new URL(`../../../fixtures/reference/${name}`, import.meta.url));
  return parseRelGeo(readFileSync(filePath, "utf8"));
}

describe("reference fixtures", () => {
  it("resolves text-anchor multiline fixture from shared reference folder", () => {
    const doc = loadFixture("01-text-anchor-multiline.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.objects.title).toBeDefined();
    expect(scene.objects.footer).toBeDefined();

    const title = scene.objects.title as any;
    const footer = scene.objects.footer as any;

    expect(title.x).toBeCloseTo(58.4);
    expect(title.y).toBeCloseTo(24);
    expect(title.width).toBeCloseTo(43.2);
    expect(title.height).toBeCloseTo(31.2);

    expect(footer.x).toBeCloseTo(146.8);
    expect(footer.y).toBeCloseTo(88.8);
    expect(footer.width).toBeCloseTo(43.2);
    expect(footer.height).toBeCloseTo(31.2);
  });

  it("resolves mixed presentational sheet fixture from shared reference folder", () => {
    const doc = loadFixture("02-mixed-presentational-sheet.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.views?.mixedView).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();
    expect(scene.objects.note).toBeDefined();
    expect(scene.objects.dim).toBeDefined();
    expect(scene.objects.title).toBeDefined();

    const title = scene.objects.title as any;
    const note = scene.objects.note as any;
    const dim = scene.objects.dim as any;

    expect(title.x).toBeCloseTo(58.4);
    expect(title.y).toBeCloseTo(24);
    expect(note.leader.from.x).toBe(140);
    expect(note.leader.to.x).toBe(185);
    expect(dim.offset).toBe(-14);
    expect(dim.text).toBe("120mm");
  });

  it("resolves sheet title block fixture from shared reference folder", () => {
    const doc = loadFixture("03-sheet-title-block.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.meta?.title).toBe("Rear Panel");
    expect(scene.meta?.version).toBe("1.2");
    expect(scene.meta?.date).toBe("2026-06-23");
    expect(scene.views?.front).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();

    const sheet = scene.sheets?.drawing1 as any;
    expect(sheet.meta?.title).toBe("Assembly Sheet");
    expect(sheet.size).toBe("A4");
  });

  it("resolves grouped sheet rooting fixture from shared reference folder", () => {
    const doc = loadFixture("04-grouped-sheet-rooting.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.views?.front).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();
    expect(scene.objects.assembly).toBeDefined();
    expect(scene.objects.panel).toBeDefined();

    const view = scene.views?.front as any;
    expect(view.target).toBe("assembly");
    expect(view.bbox.x).toBeCloseTo(10);
    expect(view.bbox.y).toBeCloseTo(20);
    expect(view.bbox.width).toBeCloseTo(100);
    expect(view.bbox.height).toBeCloseTo(50);
  });

  it("resolves clone sheet target fixture from shared reference folder", () => {
    const doc = loadFixture("05-clone-sheet-target.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.views?.cloneView).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();
    expect(scene.objects.shifted).toBeDefined();
    expect(scene.objects.base).toBeDefined();

    const view = scene.views?.cloneView as any;
    expect(view.target).toBe("shifted");
    expect(view.bbox.x).toBeCloseTo(200);
    expect(view.bbox.y).toBeCloseTo(0);
    expect(view.bbox.width).toBeCloseTo(100);
    expect(view.bbox.height).toBeCloseTo(50);
  });

  it("resolves nested structural sheet fixture from shared reference folder", () => {
    const doc = loadFixture("06-nested-structural-sheet.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.views?.nestedView).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();
    expect(scene.objects.cluster).toBeDefined();
    expect(scene.objects.assembly).toBeDefined();
    expect(scene.objects.note).toBeDefined();

    const note = scene.objects.note as any;
    expect(note.leader.from.x).toBe(90);
    expect(note.leader.from.y).toBe(50);
    expect(note.leader.to.x).toBe(145);
    expect(note.leader.to.y).toBe(70);
  });

  it("resolves component sheet meta override fixture from shared reference folder", () => {
    const doc = loadFixture("07-component-sheet-meta-override.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.views?.componentView).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();
    expect(scene.objects.inst).toBeDefined();
    expect(scene.objects["inst.shape"]).toBeDefined();

    const shape = scene.objects["inst.shape"] as any;
    const inst = scene.objects.inst as any;
    const view = scene.views?.componentView as any;

    expect(shape.x).toBeCloseTo(40);
    expect(shape.y).toBeCloseTo(15);
    expect(shape.width).toBeCloseTo(80);
    expect(shape.height).toBeCloseTo(30);
    expect(inst.meta?.stroke).toBe("#2244ff");
    expect(view.target).toBe("inst");
  });

  it("resolves sheet xml escaping fixture from shared reference folder", () => {
    const doc = loadFixture("08-sheet-xml-escaping.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.meta?.version).toBe("1<2&3>");
    expect(scene.meta?.date).toBe("2026-07-08");
    expect(scene.views?.["front&detail"]).toBeDefined();
    expect(scene.sheets?.drawing1).toBeDefined();

    const note = scene.objects.note as any;
    const sheet = scene.sheets?.drawing1 as any;
    const view = scene.views?.["front&detail"] as any;

    expect(note.content).toBe("A&B <main>");
    expect(sheet.meta?.title).toBe("Assembly <A&B>");
    expect(view.scale).toBe("1<2");
  });

  it("resolves multi-sheet title block fixture from shared reference folder", () => {
    const doc = loadFixture("09-multi-sheet-title-block.yaml");
    const scene = resolveGeometry(doc);

    expect(scene.meta?.version).toBe("BRKT-2026.07");
    expect(scene.meta?.date).toBe("2026-07-13");
    expect(scene.views?.front).toBeDefined();
    expect(scene.views?.detail).toBeDefined();
    expect(scene.sheets?.sheetA).toBeDefined();
    expect(scene.sheets?.sheetB).toBeDefined();

    const sheetA = scene.sheets?.sheetA as any;
    const sheetB = scene.sheets?.sheetB as any;
    const detailView = scene.views?.detail as any;

    expect(sheetA.meta?.title).toBe("Bracket Assembly Sheet");
    expect(sheetA.meta?.sheetSize).toBe("A4 Landscape");
    expect(sheetB.meta?.title).toBe("Bracket Detail Sheet");
    expect(sheetB.meta?.version).toBe("BRKT-DET-02");
    expect(sheetB.meta?.date).toBe("2026-07-14");
    expect(sheetB.meta?.sheetSize).toBe("A4 Detail");
    expect(detailView.scale).toBe("2:1");
  });
});
