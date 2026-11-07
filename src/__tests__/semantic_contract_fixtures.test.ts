import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectDiagnostics,
  parseRelGeo,
  resolveGeometry,
  toDiagnostic,
} from "../index";

type FixtureManifest = {
  fixtures: Array<{
    id: string;
    path: string;
    status: string;
    expectedDiagnostic?: string;
    expectedResolutionError?: string;
    coreContract?: Record<string, unknown>;
  }>;
};

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../fixtures/manifest.json", import.meta.url)), "utf8"),
) as FixtureManifest;

function fixture(id: string) {
  const entry = manifest.fixtures.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing fixture manifest entry: ${id}`);
  return entry;
}

function fixtureSource(id: string) {
  const entry = fixture(id);
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/${entry.path}`, import.meta.url)),
    "utf8",
  );
}

describe("semantic contract fixtures", () => {
  it("declares the focused reference, constraint, result, and recovery matrix", () => {
    expect(fixture("v05-invalid-reference-path").coreContract).toMatchObject({
      kind: "reference-failure",
      code: "UNKNOWN_IDENTIFIER",
      path: "objects.marker.at[0]",
    });
    expect(fixture("v05-runtime-align-violation").coreContract).toMatchObject({
      kind: "constraint-diagnostic",
      capabilityIds: ["CON-001", "CON-002"],
      retainsResolvedScene: true,
    });
    expect(fixture("v05-runtime-empty-boolean").coreContract).toMatchObject({
      kind: "empty-result",
      strict: "throws",
    });
    expect(fixture("v05-runtime-multipart-boolean").coreContract).toMatchObject({
      kind: "result-mode",
      singleMode: "throws",
    });
    expect(fixture("v05-runtime-empty-collection").coreContract).toMatchObject({
      kind: "empty-collection",
      editorMode: "tolerant",
    });
    expect(fixture("v05-invalid-incomplete-editor").coreContract).toMatchObject({
      kind: "editor-recovery",
      strictCode: "MISSING_REQUIRED_FIELD",
      multiDiagnosticCount: 2,
    });
    expect(fixture("v05-collection-boolean-contract").coreContract).toMatchObject({
      kind: "collection-boolean",
      booleanOperations: ["union", "xor"],
      repeatModes: ["along", "grid", "polar", "each"],
      stableChildIdentity: true,
    });
    expect(fixture("v05-geometry-composition-placement-query").coreContract).toMatchObject({
      kind: "geometry-composition-placement-query",
      capabilityIds: [
        "GEO-001",
        "GEO-002",
        "GEO-003",
        "GEO-004",
        "GEO-005",
        "COMP-001",
        "COMP-002",
        "COMP-003",
        "PLACE-001",
        "PLACE-003",
        "ANCH-001",
        "QUERY-002",
      ],
      stableIdentityAndOrder: true,
      typedQueries: true,
    });
    expect(fixture("v05-collection-constraint-contract").coreContract).toMatchObject({
      kind: "collection-constraint",
      capabilityIds: ["COLL-001", "COLL-002", "COLL-003", "COLL-004", "CON-001", "CON-002"],
      stableIdentityAndOrder: true,
      noMutation: true,
    });
    expect(fixture("v05-presentation-metadata-serialization").coreContract).toMatchObject({
      kind: "presentation-metadata-serialization",
      capabilityIds: ["PRES-001", "PRES-002", "PRES-003", "PRES-004", "META-001", "META-002", "SER-001", "SER-002"],
      dimensionKinds: ["linear", "radius", "diameter", "angle"],
      viewAndSheetComposition: true,
      canonicalResolvedScene: true,
      safeSemanticSvg: true,
    });
  });

  it("resolves the active collection and boolean capability fixture deterministically", () => {
    const doc = parseRelGeo(fixtureSource("v05-collection-boolean-contract"));
    const first = resolveGeometry(doc);
    const second = resolveGeometry(doc);

    expect(first.objects.merged).toMatchObject({ type: "boolean", operation: "union" });
    expect(first.objects.symmetricDifference).toMatchObject({
      type: "collection",
      children: ["symmetricDifference[0]", "symmetricDifference[1]"],
    });
    expect(first.objects["symmetricDifference[0]"]).toMatchObject({ type: "boolean", operation: "xor" });
    expect(first.objects["symmetricDifference[1]"]).toMatchObject({ type: "boolean", operation: "xor" });
    for (const id of ["alongMarks", "gridMarks", "polarMarks", "eachMarks"]) {
      expect(first.objects[id]).toMatchObject({ type: "collection" });
      expect((first.objects[id] as any).children.length).toBeGreaterThan(0);
      expect((first.objects[id] as any).children).toEqual((second.objects[id] as any).children);
    }
    expect(first.values).toMatchObject({
      alongCount: 3,
      firstAlongX: 0,
      lastAlongX: 100,
      lastGridX: 10,
    });
    expect(first.objects).toEqual(second.objects);
    expect(first.values).toEqual(second.values);
  });

  it("resolves the collection and constraint contract with stable shapes, access, and no mutation", () => {
    const doc = parseRelGeo(fixtureSource("v05-collection-constraint-contract"));
    const first = resolveGeometry(doc);
    const second = resolveGeometry(doc);

    expect(first.objects.splitPieces).toMatchObject({
      type: "collection",
      children: ["splitPieces[0]", "splitPieces[1]"],
    });
    expect(first.objects.splitHead).toMatchObject({ type: "path" });
    expect(first.objects.divided).toMatchObject({
      type: "collection",
      children: ["divided[0]", "divided[1]", "divided[2]"],
    });
    expect(first.objects.repeatMarks).toMatchObject({
      type: "collection",
      children: ["repeatMarks[0]", "repeatMarks[1]", "repeatMarks[2]"],
    });
    expect(first.objects.gridMarks).toMatchObject({
      type: "collection",
      children: ["gridMarks[0,0]", "gridMarks[0,1]", "gridMarks[1,0]", "gridMarks[1,1]"],
    });
    expect(first.objects.xor).toMatchObject({
      type: "collection",
      children: ["xor[0]", "xor[1]"],
    });
    expect(first.values).toMatchObject({
      repeatCount: 3,
      repeatFirstX: 0,
      repeatLastX: 10,
      repeatIndexedX: 5,
      splitCount: 2,
      splitFirstStartX: 0,
      splitLastEndX: 20,
      divideCount: 3,
      divideMiddleX: 10,
      gridLastX: 6,
    });
    expect(first.violations).toEqual([]);
    expect(first.objects.edge).toMatchObject({ type: "line", x1: 0, y1: 0, x2: 20, y2: 0 });
    expect(first.objects).toEqual(second.objects);
    expect(first.values).toEqual(second.values);
    expect(first.violations).toEqual(second.violations);
  });

  it("resolves the residual geometry/composition/placement/query fixture across the shared contract", () => {
    const doc = parseRelGeo(fixtureSource("v05-geometry-composition-placement-query"));
    const first = resolveGeometry(doc);
    const second = resolveGeometry(doc);

    expect(first.objects.offset).toMatchObject({ type: "point", x: 20, y: 10 });
    expect(first.objects.fromTo).toMatchObject({ type: "line", x1: 0, y1: 0, x2: 20, y2: 10 });
    expect(first.objects.directed).toMatchObject({ type: "line", x1: 0, y1: 0, x2: 20, y2: 0 });
    expect(first.objects.panel).toMatchObject({ type: "rect", x: 0, y: 15, width: 30, height: 20 });
    expect((first.objects.panel as any).holes).toHaveLength(1);
    expect(first.objects.disk).toMatchObject({ type: "circle", cx: 15, cy: 25, radius: 4 });
    expect(first.objects.oval).toMatchObject({ type: "ellipse", cx: 35, cy: 25, rx: 5, ry: 3 });
    expect(first.objects.arc).toMatchObject({ type: "arc", cx: 50, cy: 25, radius: 5 });
    expect(first.objects.quadratic).toMatchObject({ type: "quadratic", x1: 0, y1: 45, x2: 20, y2: 45 });
    expect(first.objects.cubic).toMatchObject({ type: "cubic", x1: 25, y1: 45, x2: 45, y2: 45 });
    expect(first.objects.route).toMatchObject({ type: "path" });
    expect((first.objects.route as any).segments).toHaveLength(2);
    expect(first.objects.outline).toMatchObject({ type: "polygon" });
    expect(first.objects.closedRoute).toMatchObject({ type: "path", closed: true });
    expect((first.objects.closedRoute as any).holes).toHaveLength(1);
    expect(first.objects.label).toMatchObject({ type: "text", content: "Residual contract" });

    expect(first.objects.assembly).toMatchObject({ type: "group", children: ["panel", "disk"] });
    expect(first.objects.copy).toMatchObject({ type: "clone", of: "panel", children: ["panel"] });
    expect(first.objects.instance).toMatchObject({ type: "component", use: "marker", children: ["instance.body"] });
    expect(first.objects["instance.body"]).toMatchObject({ type: "rect", width: 8, height: 8 });
    expect(first.objects.insidePanel).toMatchObject({ type: "rect", x: 2, y: 17, width: 10, height: 8 });
    expect(first.objects.onRoute).toMatchObject({ type: "rect", x: 59, y: 44, width: 2, height: 2 });
    expect(first.objects.atHook).toMatchObject({ type: "point", x: 105, y: 50 });
    expect(first.objects.queryPoint).toMatchObject({ type: "point", x: 60, y: 45 });
    expect(first.objects.worldPoint).toMatchObject({ type: "point", x: 100, y: 0 });
    expect(first.values).toMatchObject({ routeMidX: 60, fromToLength: expect.closeTo(Math.sqrt(500), 1e-12) });
    expect(first.values.routeTangentX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(first.objects).toEqual(second.objects);
    expect(first.values).toEqual(second.values);
  });

  it("resolves presentation kinds, role metadata, views, sheets, and stable serialization without geometry mutation", () => {
    const source = fixtureSource("v05-presentation-metadata-serialization");
    const doc = parseRelGeo(source, { mode: "validate" });
    const first = resolveGeometry(doc, { mode: "validate" });
    const second = resolveGeometry(doc, { mode: "validate" });

    expect(first.objects.linearDimension).toMatchObject({ type: "dimension", kind: "linear", distance: 40, text: "L=40mm" });
    expect(first.objects.radiusDimension).toMatchObject({ type: "dimension", kind: "radius", distance: 8, text: "R=8mm" });
    expect(first.objects.diameterDimension).toMatchObject({ type: "dimension", kind: "diameter", distance: 16, text: "D=16mm" });
    expect(first.objects.angleDimension).toMatchObject({ type: "dimension", kind: "angle", angle: 90, text: "A=90°" });
    expect(first.objects.note).toMatchObject({ type: "annotation", target: "circle", text: "<script>alert(2)</script>" });
    expect(first.objects.leader).toMatchObject({ type: "annotation", leader: { from: { x: 30, y: 25 }, to: { x: 60, y: 55 } } });

    expect(first.objects.panel.meta).toMatchObject({ role: "final", material: "aluminum", partNo: "P-033" });
    expect(first.objects.guide.meta).toMatchObject({ role: "guide", dash: "4 2" });
    expect(first.objects.centerline.meta).toMatchObject({ role: "centerline" });
    expect(first.objects.hidden.meta).toMatchObject({ role: "hidden", visible: false });
    expect(first.objects.note.meta).toMatchObject({ role: "annotation", fontSize: 10 });
    expect(first.views?.front).toMatchObject({ id: "front", target: "panel", scaleFactor: 1 });
    expect(first.views?.detail).toMatchObject({ id: "detail", target: "circle", scaleFactor: 2 });
    expect(first.sheets?.drawing).toMatchObject({ id: "drawing", size: "A4", width: 210, height: 297 });
    expect(first.sheets?.drawing.views).toEqual([
      { use: "front", x: 20, y: 20, width: 40, height: 30 },
      { use: "detail", x: 104, y: 154, width: 32, height: 32 },
    ]);
    expect(first.meta).toMatchObject({ title: "<script>alert(1)</script>", author: "A&B" });
    expect(first.violations).toEqual([]);
    expect(first.objects).toEqual(second.objects);
    expect(first.views).toEqual(second.views);
    expect(first.sheets).toEqual(second.sheets);

    const metadataFree = JSON.parse(JSON.stringify(doc));
    delete metadataFree.meta;
    delete metadataFree.styles;
    delete metadataFree.metaPresets;
    for (const object of Object.values(metadataFree.objects as Record<string, any>)) {
      delete (object as any).meta;
      delete (object as any).style;
      delete (object as any).metaPreset;
    }
    for (const view of Object.values(metadataFree.views as Record<string, any>)) delete (view as any).meta;
    for (const sheet of Object.values(metadataFree.sheets as Record<string, any>)) delete (sheet as any).meta;
    const withoutMetadata = resolveGeometry(metadataFree, { mode: "validate" });
    for (const id of ["panel", "construction", "guide", "centerline", "hidden", "circle", "horizontal", "vertical"]) {
      const before = first.objects[id] as any;
      const after = withoutMetadata.objects[id] as any;
      expect({ ...before, meta: undefined }).toEqual({ ...after, meta: undefined });
    }
  });

  it("keeps reference failure code, phase, path, and strict behavior stable", () => {
    const source = fixtureSource("v05-invalid-reference-path");
    let failure: unknown;
    try {
      parseRelGeo(source, { mode: "validate" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "UNKNOWN_IDENTIFIER",
      phase: "parse",
      severity: "error",
      path: "objects.marker.at[0]",
    });
    expect((failure as Error).message).toContain("Unknown identifier: missing.x");
  });

  it("retains resolved geometry while constraint diagnostics stay deterministic", () => {
    const source = fixtureSource("v05-runtime-align-violation");
    const doc = parseRelGeo(source, { mode: "validate" });
    const first = resolveGeometry(doc, { mode: "validate" });
    const second = resolveGeometry(doc, { mode: "validate" });

    expect(first.objects.first).toMatchObject({ id: "first", type: "point", x: 0, y: 0 });
    expect(first.objects.second).toMatchObject({ id: "second", type: "point", x: 10, y: 10 });
    expect(first.violations).toHaveLength(1);
    expect(first.violations?.[0]).toMatchObject({
      type: "align",
      path: "constraints[0]",
      involvedObjects: ["first", "second"],
    });
    expect(first.violations).toEqual(second.violations);
    expect(first.objects).toEqual(second.objects);
  });

  it.each([
    ["v05-runtime-empty-boolean", "BOOLEAN_EMPTY_RESULT"],
    ["v05-runtime-multipart-boolean", "BOOLEAN_MULTIPART_RESULT"],
    ["v05-runtime-empty-collection", "INVALID_COLLECTION_ACCESS"],
  ] as const)("keeps %s strict failure deterministic", (id, expectedCode) => {
    const source = fixtureSource(id);
    const doc = parseRelGeo(source);
    const failures: ReturnType<typeof toDiagnostic>[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        resolveGeometry(doc, { mode: "compile" });
      } catch (error) {
        failures.push(toDiagnostic(error));
      }
    }

    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      code: expectedCode,
      severity: "error",
    });
    expect(failures[0]).toEqual(failures[1]);
  });

  it("keeps empty collection access tolerant in editor mode", () => {
    const source = fixtureSource("v05-runtime-empty-collection");
    const editorDoc = parseRelGeo(source, { mode: "editor" });
    const scene = resolveGeometry(editorDoc, { mode: "editor" });

    expect(scene.objects.empty).toMatchObject({ type: "collection", children: [] });
    expect(scene.objects.marker).toMatchObject({ type: "point", x: 0, y: 0 });
  });

  it("aggregates incomplete local failures while preserving editor recovery", () => {
    const source = fixtureSource("v05-invalid-incomplete-editor");
    const diagnostics = collectDiagnostics(source);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.objectId)).toEqual(["panel", "secondary"]);
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      "objects.panel",
      "objects.secondary",
    ]);
    expect(diagnostics.every((diagnostic) =>
      diagnostic.code === "MISSING_REQUIRED_FIELD"
      && diagnostic.phase === "validate"
      && diagnostic.severity === "error",
    )).toBe(true);

    const editorDoc = parseRelGeo(source, { mode: "editor" });
    const editorScene = resolveGeometry(editorDoc, { mode: "editor" });
    expect(editorScene.objects.panel).toMatchObject({ type: "rect", width: 0, height: 0 });
    expect(editorScene.objects.secondary).toMatchObject({ type: "rect", width: 0, height: 0 });

    expect(() => parseRelGeo(source, { mode: "validate" })).toThrow(expect.objectContaining({
      code: "MISSING_REQUIRED_FIELD",
      phase: "parse",
      path: "objects.panel.size",
    }));
  });
});
