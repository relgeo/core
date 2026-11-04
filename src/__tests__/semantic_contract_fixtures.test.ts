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
      code: "INVALID_EXPRESSION",
      path: "objects.marker.at[0]",
    });
    expect(fixture("v05-runtime-align-violation").coreContract).toMatchObject({
      kind: "constraint-diagnostic",
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
      code: "INVALID_EXPRESSION",
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
      involvedObjects: [],
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
