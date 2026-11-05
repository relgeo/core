import type {
  ConstraintViolation,
  RelGeoDiagnostic,
  RelGeoDocument,
  RelGeoMode,
  SourceRange,
} from "./types";
import { ParseError, parseRelGeo, sourceRangeForPath } from "./parser";
import { Validator } from "./validator";
import { resolveGeometry } from "./resolver";
import { getObjectDependencies } from "./graph";
import { sortDiagnostics, toDiagnostic } from "./errors";

export interface CollectDiagnosticsOptions {
  mode?: RelGeoMode;
  includeResolution?: boolean;
  maxDiagnostics?: number;
}

function rangeForPath(source: string | undefined, path: string | undefined): SourceRange | undefined {
  return source ? sourceRangeForPath(source, path) : undefined;
}

function pushValidationDiagnostic(
  diagnostics: RelGeoDiagnostic[],
  error: unknown,
  source?: string,
  objectId?: string,
): void {
  const candidate = error && typeof error === "object" ? error as { path?: string; objectId?: string } : {};
  diagnostics.push(toDiagnostic(error, {
    phase: "validate",
    range: rangeForPath(source, candidate.path),
  }));
  const last = diagnostics.at(-1);
  const pathObjectId = candidate.path?.match(/^objects\.([^.[\]]+)/)?.[1];
  if (last && !last.objectId) last.objectId = objectId ?? pathObjectId;
}

function dependencyClosure(doc: RelGeoDocument, rootId: string): Set<string> {
  const objects = doc.objects ?? {};
  const objectIds = new Set(Object.keys(objects));
  const included = new Set<string>();
  const pending = [rootId];

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (included.has(id) || !objects[id]) continue;
    included.add(id);
    const dependencies = getObjectDependencies(id, objects[id], objectIds, undefined, doc);
    for (const dependency of dependencies) {
      if (!included.has(dependency)) pending.push(dependency);
    }
  }

  return included;
}

function collectIndependentResolutionDiagnostics(
  doc: RelGeoDocument,
  mode: RelGeoMode,
  diagnostics: RelGeoDiagnostic[],
  source?: string,
): void {
  const objects = doc.objects ?? {};
  for (const objectId of Object.keys(objects)) {
    const ids = dependencyClosure(doc, objectId);
    const isolatedObjects = Object.fromEntries([...ids].map((id) => [id, objects[id]]));
    const isolatedDoc: RelGeoDocument = {
      ...doc,
      objects: isolatedObjects,
      // Constraints/views/sheets can reference objects outside the closure and
      // would turn an independent object probe into unrelated noise.
      constraints: undefined,
      views: undefined,
      sheets: undefined,
    };

    try {
      resolveGeometry(isolatedDoc, { mode });
    } catch (error) {
      const candidate = error && typeof error === "object"
        ? error as { path?: string; objectId?: string }
        : {};
      const path = candidate.path ?? `objects.${objectId}`;
      diagnostics.push(toDiagnostic(error, {
        phase: "resolve",
        path,
        objectId: candidate.objectId ?? objectId,
        range: rangeForPath(source, path),
      }));
    }
  }
}

/**
 * Collect bounded, deterministic diagnostics without changing strict resolver
 * behavior. The per-object pass adds independent local structural failures;
 * cross-object semantics still use the normal full-document validator.
 */
export function collectDiagnostics(
  input: string | RelGeoDocument,
  options: CollectDiagnosticsOptions = {},
): RelGeoDiagnostic[] {
  const mode = options.mode ?? "validate";
  const requestedMax = options.maxDiagnostics ?? 100;
  const maxDiagnostics = Number.isFinite(requestedMax)
    ? Math.max(0, Math.floor(requestedMax))
    : 100;
  const diagnostics: RelGeoDiagnostic[] = [];
  let doc: RelGeoDocument;
  let source: string | undefined;

  if (typeof input === "string") {
    source = input;
    try {
      // Editor parsing preserves the document envelope so validation can report
      // more than the first strict-parser failure.
      doc = parseRelGeo(input, { mode: "editor" });
    } catch (error) {
      const parseError = error instanceof ParseError ? error : error;
      diagnostics.push(toDiagnostic(parseError, {
        phase: "parse",
        fallbackCode: "INVALID_YAML",
        range: (parseError as ParseError).range,
      }));
      return sortDiagnostics(diagnostics).slice(0, maxDiagnostics);
    }
  } else {
    doc = input;
  }

  try {
    new Validator(doc, mode).validate();
  } catch (error) {
    pushValidationDiagnostic(diagnostics, error, source);
  }

  for (const [objectId, object] of Object.entries(doc.objects ?? {})) {
    try {
      const isolatedDoc: RelGeoDocument = { ...doc, objects: { [objectId]: object } };
      new Validator(isolatedDoc, mode).validate();
    } catch (error) {
      const candidate = error && typeof error === "object" ? error as { code?: string } : {};
      // Isolated validation is only additional evidence for local structural
      // failures; references are validated against the full document above.
      const localCodes = new Set([
        "UNKNOWN_FIELD",
        "INVALID_OBJECT_TYPE",
        "MISSING_REQUIRED_FIELD",
        "INVALID_VALUE",
        "INVALID_BOOLEAN_OPERATION",
        "TYPE_MISMATCH",
      ]);
      if (!candidate.code || localCodes.has(candidate.code)) {
        pushValidationDiagnostic(diagnostics, error, source, objectId);
      }
    }
  }

  const orderedValidation = sortDiagnostics(diagnostics);
  if (orderedValidation.length === 0 && options.includeResolution !== false) {
    try {
      const scene = resolveGeometry(doc, { mode });
      for (const violation of scene.violations ?? []) {
        diagnostics.push(diagnosticFromConstraint(violation));
      }
    } catch (error) {
      diagnostics.push(toDiagnostic(error, { phase: "resolve" }));
      collectIndependentResolutionDiagnostics(doc, mode, diagnostics, source);
    }
  }

  return sortDiagnostics(diagnostics).slice(0, maxDiagnostics);
}

function diagnosticFromConstraint(violation: ConstraintViolation): RelGeoDiagnostic {
  return {
    code: "CONSTRAINT_VIOLATION",
    message: violation.message,
    path: violation.path,
    objectId: violation.involvedObjects[0],
    phase: "constraint",
    severity: violation.severity ?? "error",
    constraintType: violation.type,
    origin: violation.origin ?? "constraint",
    expected: violation.expected,
    actual: violation.actual,
  };
}
