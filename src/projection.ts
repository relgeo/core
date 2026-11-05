import type { ResolvedScene } from "./types";
import { CoreError } from "./errors";

export const RESOLVED_SCENE_PROJECTION_SCHEMA = "relgeo.resolved-scene" as const;
export const RESOLVED_SCENE_PROJECTION_VERSION = 1 as const;
export const RESOLVED_SCENE_COMPATIBILITY_LINE = "0.5" as const;

export interface ResolvedSceneProjection {
  schema: typeof RESOLVED_SCENE_PROJECTION_SCHEMA;
  schemaVersion: typeof RESOLVED_SCENE_PROJECTION_VERSION;
  compatibilityLine: typeof RESOLVED_SCENE_COMPATIBILITY_LINE;
  unit: ResolvedScene["unit"];
  orientation?: ResolvedScene["orientation"];
  origin?: ResolvedScene["origin"];
  autoSize?: boolean;
  padding?: number;
  objectOrder: string[];
  objects: Record<string, unknown>;
  parameterOrder: string[];
  parameters: Record<string, unknown>;
  values: Record<string, unknown>;
  bbox: unknown;
  meta?: unknown;
  violations: unknown[];
  viewOrder: string[];
  views: Record<string, unknown>;
  sheetOrder: string[];
  sheets: Record<string, unknown>;
}

export interface ResolvedSceneReplayComparison {
  equal: boolean;
  expected: string;
  actual: string;
}

export type SemanticReplayInput = ResolvedScene | ResolvedSceneProjection | string;

const NUMBER_PRECISION = 12;

function normalizeNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new CoreError(`non-finite number at ${path}`, "INVALID_RESOLVED_SCENE", { phase: "runtime", path });
  }
  const normalized = Number(value.toFixed(NUMBER_PRECISION));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function canonicalize(value: unknown, path: string): unknown {
  if (typeof value === "number") return normalizeNumber(value, path);
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    result[key] = canonicalize(record[key], `${path}.${key}`);
  }
  return result;
}

function canonicalRecord(value: unknown, path: string): Record<string, unknown> {
  return (canonicalize(value ?? {}, path) ?? {}) as Record<string, unknown>;
}

function canonicalizeSerializedSnapshot(input: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new CoreError(
      `expected JSON (${error instanceof Error ? error.message : String(error)})`,
      "INVALID_SEMANTIC_SNAPSHOT",
      { phase: "runtime", path: "snapshot" },
    );
  }
  if (parsed && typeof parsed === "object" && "schema" in parsed) {
    assertProjectionCompatibility(parsed as Partial<ResolvedSceneProjection>);
  }
  return JSON.stringify(canonicalize(parsed, "snapshot"));
}

function assertProjectionCompatibility(input: Partial<ResolvedSceneProjection>): void {
  if (input.schema !== RESOLVED_SCENE_PROJECTION_SCHEMA) {
    throw new CoreError("unsupported semantic projection schema", "INVALID_SEMANTIC_SNAPSHOT", {
      phase: "runtime",
      path: "projection.schema",
    });
  }
  if (input.schemaVersion !== RESOLVED_SCENE_PROJECTION_VERSION) {
    throw new CoreError("unsupported semantic projection schema version", "INVALID_SEMANTIC_SNAPSHOT", {
      phase: "runtime",
      path: "projection.schemaVersion",
    });
  }
  if (input.compatibilityLine !== RESOLVED_SCENE_COMPATIBILITY_LINE) {
    throw new CoreError("incompatible semantic projection compatibility line", "INVALID_SEMANTIC_SNAPSHOT", {
      phase: "runtime",
      path: "projection.compatibilityLine",
    });
  }
}

function serializeSemanticReplayInput(input: SemanticReplayInput): string {
  if (typeof input === "string") return canonicalizeSerializedSnapshot(input);
  if (
    input
    && typeof input === "object"
    && (input as Partial<ResolvedSceneProjection>).schema === RESOLVED_SCENE_PROJECTION_SCHEMA
  ) {
    assertProjectionCompatibility(input as Partial<ResolvedSceneProjection>);
    return JSON.stringify(canonicalize(input, "projection"));
  }
  return serializeResolvedScene(input as ResolvedScene);
}

/**
 * Project a resolved scene into the versioned, renderer-neutral semantic
 * contract. Ordering is represented explicitly while object keys and numbers
 * are canonicalized for stable snapshots and downstream consumers.
 */
export function projectResolvedScene(scene: ResolvedScene): ResolvedSceneProjection {
  const objectOrder = Object.keys(scene.objects ?? {});
  const parameterOrder = Object.keys(scene.parameters ?? {});
  const viewOrder = Object.keys(scene.views ?? {});
  const sheetOrder = Object.keys(scene.sheets ?? {});

  return {
    schema: RESOLVED_SCENE_PROJECTION_SCHEMA,
    schemaVersion: RESOLVED_SCENE_PROJECTION_VERSION,
    compatibilityLine: RESOLVED_SCENE_COMPATIBILITY_LINE,
    unit: scene.unit,
    ...(scene.orientation === undefined ? {} : { orientation: scene.orientation }),
    ...(scene.origin === undefined ? {} : { origin: scene.origin }),
    ...(scene.autoSize === undefined ? {} : { autoSize: scene.autoSize }),
    ...(scene.padding === undefined ? {} : { padding: normalizeNumber(scene.padding, "padding") }),
    objectOrder: [...objectOrder],
    objects: canonicalRecord(scene.objects, "objects"),
    parameterOrder: [...parameterOrder],
    parameters: canonicalRecord(scene.parameters, "parameters"),
    values: canonicalRecord(scene.values, "values"),
    bbox: canonicalize(scene.bbox, "bbox"),
    ...(scene.meta === undefined ? {} : { meta: canonicalize(scene.meta, "meta") }),
    violations: (scene.violations ?? []).map((violation, index) => canonicalize(violation, `violations[${index}]`)),
    viewOrder: [...viewOrder],
    views: canonicalRecord(scene.views, "views"),
    sheetOrder: [...sheetOrder],
    sheets: canonicalRecord(scene.sheets, "sheets"),
  };
}

/** Serialize the canonical semantic projection for JSON consumers. */
export function serializeResolvedScene(scene: ResolvedScene): string {
  return JSON.stringify(projectResolvedScene(scene));
}

/**
 * Compare two semantic scene values using the same canonical rules used by
 * serialization. String inputs may be snapshots produced by another process;
 * object inputs may be resolved scenes or already-projected snapshots.
 */
export function compareResolvedSceneReplay(
  expected: SemanticReplayInput,
  actual: SemanticReplayInput,
): ResolvedSceneReplayComparison {
  const expectedSnapshot = serializeSemanticReplayInput(expected);
  const actualSnapshot = serializeSemanticReplayInput(actual);
  return {
    equal: expectedSnapshot === actualSnapshot,
    expected: expectedSnapshot,
    actual: actualSnapshot,
  };
}
