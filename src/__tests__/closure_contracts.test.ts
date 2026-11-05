import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REL_GEO_ERROR_CODES,
  parseRelGeo,
  projectResolvedScene,
  resolveGeometry,
  toDiagnostic,
} from "../index";

const contractSource = readFileSync(
  fileURLToPath(new URL("../../../spec/id/core/07-closure-contracts.md", import.meta.url)),
  "utf8",
);
const errorModelSource = readFileSync(
  fileURLToPath(new URL("../../../spec/id/core/06-error-model.md", import.meta.url)),
  "utf8",
);

const closureIds = [
  "CORE-INPUT-002",
  "CORE-MODEL-002",
  "CORE-VALID-003",
  "CORE-VALID-004",
  "CORE-ERROR-001",
  "CORE-ERROR-002",
  "CORE-RESOLVE-003",
  "CORE-RESOLVE-005",
  "CORE-CONSTRAINT-002",
  "CORE-DIAG-001",
  "CORE-DIAG-002",
  "CORE-ERROR-003",
  "CORE-DET-002",
  "CORE-INT-002",
  "CORE-INT-004",
] as const;

describe("frozen Core closure contracts", () => {
  it("keeps every actionable gap represented exactly once in the normative register", () => {
    const registeredIds = [...contractSource.matchAll(/^\| `(CORE-[A-Z0-9-]+)` \|/gm)]
      .map((match) => match[1]);

    expect(registeredIds).toEqual([...closureIds]);
    expect(new Set(registeredIds).size).toBe(closureIds.length);
  });

  it("keeps shared v0.5 compatibility and boundary rules visible", () => {
    expect(contractSource).toContain("compatibility line aktif `0.5`");
    expect(contractSource).toContain("`0.4` tetap supported-legacy");
    expect(contractSource).toContain("`editor` boleh melakukan bounded recovery");
    expect(contractSource).toMatch(/`validate` dan `compile` tetap\s+strict/);
    expect(contractSource).toContain("Raw SVG bytes, style, viewBox");
  });

  it("keeps runtime diagnostic anchors and canonical projection aligned", () => {
    for (const code of [
      "BOOLEAN_EMPTY_RESULT",
      "BOOLEAN_MULTIPART_RESULT",
      "INVALID_COLLECTION_ACCESS",
      "CONSTRAINT_VIOLATION",
      "INVALID_RESOLVED_SCENE",
      "INVALID_SEMANTIC_SNAPSHOT",
    ]) {
      expect(REL_GEO_ERROR_CODES).toContain(code);
    }

    expect(toDiagnostic(new Error("BOOLEAN_EMPTY_RESULT: empty"))).toMatchObject({
      code: "BOOLEAN_EMPTY_RESULT",
      phase: "runtime",
      severity: "error",
    });

    const scene = resolveGeometry(parseRelGeo(`version: 0.5
objects:
  marker:
    type: point
    at: [0, 0]
`));
    expect(projectResolvedScene(scene)).toMatchObject({
      schema: "relgeo.resolved-scene",
      schemaVersion: 1,
      compatibilityLine: "0.5",
      objectOrder: ["marker"],
      viewOrder: [],
      sheetOrder: [],
    });
  });

  it("keeps normative error-model codes in the public Core catalog", () => {
    const normativeCodes = [...new Set([
      ...errorModelSource.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm),
    ].map((match) => match[1]))];

    expect(normativeCodes.length).toBeGreaterThan(0);
    expect(REL_GEO_ERROR_CODES).toEqual(
      expect.arrayContaining(normativeCodes),
    );
  });
});
