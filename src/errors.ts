import type {
  RelGeoDiagnostic,
  RelGeoDiagnosticPhase,
  RelGeoDiagnosticSeverity,
  RelGeoError,
  RelGeoErrorCode,
  SourceRange,
} from "./types";
import { REL_GEO_ERROR_CODES } from "./types";
import { ResolveError } from "./resolver/types";

const ERROR_CODE_PREFIX = /^([A-Z][A-Z0-9_]*):\s*/;
const ERROR_CODE_SET = new Set<string>(REL_GEO_ERROR_CODES);

const RUNTIME_CODES = new Set<RelGeoErrorCode>([
  "BOOLEAN_EMPTY_RESULT",
  "BOOLEAN_FAILED",
  "BOOLEAN_MULTIPART_RESULT",
  "FRAME_RESOLUTION_FAILED",
  "INVALID_COLLECTION_ACCESS",
  "INVALID_T_AT_LENGTH",
  "PATH_LENGTH_UNAVAILABLE",
  "INVALID_RESOLVED_SCENE",
  "INVALID_SEMANTIC_SNAPSHOT",
]);

const VALIDATION_CODES = new Set<RelGeoErrorCode>([
  "COMPONENT_NOT_FOUND",
  "COMPONENT_EXPORT_NOT_FOUND",
  "UNKNOWN_FIELD",
  "INVALID_OBJECT_TYPE",
  "UNKNOWN_REFERENCE",
  "UNKNOWN_ANCHOR",
  "UNKNOWN_IDENTIFIER",
  "TYPE_MISMATCH",
  "UNDER_CONSTRAINED",
  "OVER_CONSTRAINED",
  "MISSING_REQUIRED_FIELD",
  "INVALID_CONSTRAINT",
  "INVALID_VALUE",
  "INVALID_TYPE",
  "INVALID_BOOLEAN_OPERATION",
  "INVALID_OPERATION_TARGET",
  "INVALID_SCALE_FACTOR",
  "INVALID_MIRROR_AXIS",
  "INVALID_HOLE_SHAPE",
  "INVALID_INHERIT_TARGET",
  "INHERIT_TARGET_NOT_FOUND",
  "CIRCULAR_INHERIT",
  "INVALID_REPEAT_COUNT",
  "INVALID_GRID_SPACING",
  "OVER_CONSTRAINED_REPEAT_LAYOUT",
  "INVALID_REPEAT_ALONG_TARGET",
  "INVALID_REPEAT_ALONG_SPACING",
  "INVALID_FIXED_DISTANCE",
  "INVALID_OFFSET",
  "INVALID_UNIT_VALUE",
  "ELLIPSE_INVALID_RADIUS",
  "ELLIPSE_SIZE_CONFLICT",
  "INHERIT_TYPE_CONFLICT",
]);

export interface DiagnosticOptions {
  phase?: RelGeoDiagnosticPhase;
  severity?: RelGeoDiagnosticSeverity;
  range?: SourceRange;
  fallbackCode?: RelGeoErrorCode;
  path?: string;
  objectId?: string;
  dependencyChain?: string[];
}

export interface AggregateDiagnosticsOptions extends DiagnosticOptions {
  maxDiagnostics?: number;
}

export interface CoreErrorOptions {
  phase: RelGeoDiagnosticPhase;
  severity?: RelGeoDiagnosticSeverity;
  path?: string;
  objectId?: string;
  dependencyChain?: string[];
  range?: SourceRange;
}

/** Identify an exception that already carries the public diagnostic payload. */
export function hasStructuredDiagnostic(
  error: unknown,
): error is Error & Pick<RelGeoError, "phase" | "code"> {
  if (!(error instanceof Error) || typeof error !== "object") return false;
  const candidate = error as Partial<RelGeoError>;
  // A compatible-looking Error is only safe to cross a public boundary when
  // both discriminators are members of the normative public catalog. Invalid
  // values must still go through normalization instead of being re-thrown.
  return isDiagnosticPhase(candidate.phase) && isRelGeoErrorCode(candidate.code);
}

/** True when a code is part of the public core error catalog. */
export function isRelGeoErrorCode(value: unknown): value is RelGeoErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

export function stripErrorCodePrefix(message: string): string {
  return message.replace(ERROR_CODE_PREFIX, "");
}

function codeFromMessage(message: string): RelGeoErrorCode | undefined {
  const lower = message.toLowerCase();
  // Keep raw internal evaluator/resolver messages actionable when they reach
  // a public boundary. These mappings are deliberately phrase-based because
  // the underlying helpers still throw ordinary Error instances internally.
  if (lower.includes("invalid_t_parameter")) return "INVALID_VALUE";
  if (lower.includes("unsupported object selector") || lower.includes("unknown intersection selector")) {
    return "INVALID_INTERSECTION_SELECTOR";
  }
  if (lower.includes("intersection() requires at least")) return "INVALID_INTERSECTION_INPUT";
  if (lower.includes("cannot resolve geometry function") || lower.includes("without objects context")) {
    return "RESOLVE_ERROR";
  }
  if (lower.includes("cannot resolve point-like argument")) return "TYPE_MISMATCH";
  if (lower.includes("relational operators are only allowed on numbers")) return "TYPE_MISMATCH";
  if (lower.includes("arithmetic operations are only allowed on numbers/lengths")) return "TYPE_MISMATCH";
  if (lower.includes("exponentiation is only allowed on numbers")) return "TYPE_MISMATCH";
  if (lower.includes("unary minus can only be applied to numbers")) return "TYPE_MISMATCH";
  if (lower.includes("index must be a number")) return "TYPE_MISMATCH";
  if (lower.includes("cannot resolve") && lower.includes("transform without objects context")) return "RESOLVE_ERROR";
  if (lower.includes("does not expose a resolvable target")) return "INVALID_VALUE";
  if (lower.includes("operation target") && lower.includes("not found")) return "UNKNOWN_REFERENCE";
  if (lower.includes("invalid object reference")) return "UNKNOWN_REFERENCE";
  if (lower.includes("unknown member")) return "UNKNOWN_ANCHOR";
  if (lower.includes("area is only available on closed path")) return "PATH_NOT_CLOSED";
  if (lower.includes("does not resolve to a number")) return "TYPE_MISMATCH";
  if (lower.includes("does not expose a resolvable length") || lower.includes("does not expose a resolvable perimeter")) {
    return "PATH_LENGTH_UNAVAILABLE";
  }
  if (lower.includes("does not expose a resolvable pointat") || lower.includes("does not expose a resolvable tangentat") || lower.includes("does not expose a resolvable closestpoint")) {
    return "TYPE_MISMATCH";
  }
  if (lower.includes("requires a line target") || lower.includes("requires a point or line target")) {
    return "TYPE_MISMATCH";
  }
  if (lower.includes("invalid token")) return "INVALID_EXPRESSION";
  if (lower.includes("expected ':'") || lower.includes("expected member identifier") || lower.includes("missing closing bracket")) {
    return "INVALID_EXPRESSION";
  }
  if (lower.includes("requires at least") || lower.includes("requires exactly one argument")) return "INVALID_VALUE";
  if (lower.includes("index out of bounds") && lower.includes("collection")) {
    return "INVALID_COLLECTION_ACCESS";
  }
  if (lower.includes("tangent") && lower.includes("zero length")) return "TANGENT_NOT_FOUND";
  if (lower.includes("path ") && lower.includes("must be closed")) return "PATH_NOT_CLOSED";
  if (lower.includes("path ") && lower.includes("zero length")) return "PATH_LENGTH_UNAVAILABLE";
  if (lower.includes("unknown object in") || lower.includes("unknown reference in") || lower.includes("unknown base object") || lower.includes("unknown tool object") || lower.includes("unknown shape operand") || lower.includes("unknown or invalid object in")) {
    return "UNKNOWN_REFERENCE";
  }
  if (lower.includes("unknown object type")) return "INVALID_OBJECT_TYPE";
  if (lower.includes("cannot access member") || lower.includes("cannot index into") || lower.includes("only allowed on numbers")) {
    return "TYPE_MISMATCH";
  }
  if (lower.includes("missing closing") || lower.includes("expected ')' ") || lower.includes("expected argument")) {
    return "INVALID_EXPRESSION";
  }
  if (lower.includes("non-finite number at")) return "INVALID_RESOLVED_SCENE";
  if (lower.includes("expected json")) return "INVALID_SEMANTIC_SNAPSHOT";
  if (lower.includes("division by zero")) return "DIVISION_BY_ZERO";
  if (lower.includes("unknown identifier")) return "UNKNOWN_IDENTIFIER";
  if (lower.includes("unknown anchor")) return "UNKNOWN_ANCHOR";
  if (lower.includes("unknown reference")) return "UNKNOWN_REFERENCE";
  if (lower.includes("unknown function")) return "UNKNOWN_FUNCTION";
  if (lower.includes("invalid object type")) return "INVALID_OBJECT_TYPE";
  if (lower.includes("unknown field")) return "UNKNOWN_FIELD";
  if (lower.includes("unsupported feature")) return "UNSUPPORTED_FEATURE";
  if (lower.includes("invalid parameter") || lower.includes("invalid arguments")) return "INVALID_VALUE";
  if (lower.includes("missing required field") || lower.includes("requires ")) {
    return "MISSING_REQUIRED_FIELD";
  }
  if (
    lower.includes("invalid expression") ||
    lower.includes("unexpected token") ||
    lower.includes("invalid token") ||
    lower.includes("expected '")
  ) return "INVALID_EXPRESSION";
  return undefined;
}

/**
 * Normalize arbitrary internal code input to the registered public catalog.
 * Raw exception text is still preserved as the diagnostic message.
 */
export function normalizeErrorCode(
  candidate: unknown,
  message = "",
  fallback: RelGeoErrorCode = "UNKNOWN_ERROR",
): RelGeoErrorCode {
  if (isRelGeoErrorCode(candidate)) return candidate;
  const prefixedCode = typeof candidate === "string"
    ? candidate.match(ERROR_CODE_PREFIX)?.[1]
    : undefined;
  if (isRelGeoErrorCode(prefixedCode)) return prefixedCode;
  const messagePrefix = message.match(ERROR_CODE_PREFIX)?.[1];
  if (isRelGeoErrorCode(messagePrefix)) return messagePrefix;
  const messageCode = codeFromMessage(message);
  if (messageCode) return messageCode;
  return isRelGeoErrorCode(fallback) ? fallback : "UNKNOWN_ERROR";
}

function inferPhase(code: RelGeoErrorCode): RelGeoDiagnosticPhase {
  if (RUNTIME_CODES.has(code)) return "runtime";
  if (code === "CONSTRAINT_VIOLATION") return "constraint";
  if (code === "INVALID_YAML" || code === "UNSUPPORTED_SPEC_VERSION") return "parse";
  if (VALIDATION_CODES.has(code)) return "validate";
  return "resolve";
}

const DIAGNOSTIC_PHASES = new Set<RelGeoDiagnosticPhase>([
  "parse",
  "validate",
  "resolve",
  "runtime",
  "constraint",
]);

const DIAGNOSTIC_SEVERITIES = new Set<RelGeoDiagnosticSeverity>([
  "error",
  "warning",
  "info",
]);

function isDiagnosticPhase(value: unknown): value is RelGeoDiagnosticPhase {
  return typeof value === "string" && DIAGNOSTIC_PHASES.has(value as RelGeoDiagnosticPhase);
}

function isDiagnosticSeverity(value: unknown): value is RelGeoDiagnosticSeverity {
  return typeof value === "string" && DIAGNOSTIC_SEVERITIES.has(value as RelGeoDiagnosticSeverity);
}

function safeDiagnosticMessage(error: unknown, candidate: Partial<RelGeoError>): string {
  const message = diagnosticSourceMessage(error, candidate);
  const normalized = stripErrorCodePrefix(message).trim();
  return normalized || "Unknown error";
}

function diagnosticSourceMessage(error: unknown, candidate: Partial<RelGeoError>): string {
  return typeof candidate.message === "string"
    ? candidate.message
    : error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
}

/** Structured error used by public helpers that otherwise expose parser errors. */
export class CoreError extends Error implements RelGeoError {
  public readonly phase: RelGeoDiagnosticPhase;
  public readonly severity: RelGeoDiagnosticSeverity;
  public readonly code: RelGeoErrorCode;
  public readonly path?: string;
  public readonly objectId?: string;
  public readonly dependencyChain?: string[];
  public readonly range?: SourceRange;

  constructor(message: string, code: RelGeoErrorCode, options: CoreErrorOptions) {
    super(`${code}: ${stripErrorCodePrefix(message)}`);
    this.name = "CoreError";
    this.code = code;
    this.phase = isDiagnosticPhase(options.phase) ? options.phase : "resolve";
    this.severity = isDiagnosticSeverity(options.severity) ? options.severity : "error";
    this.path = options.path;
    this.objectId = options.objectId;
    this.dependencyChain = options.dependencyChain;
    this.range = options.range;
  }
}

/** Convert any public-boundary failure into the stable diagnostic shape. */
export function toDiagnostic(error: unknown, options: DiagnosticOptions = {}): RelGeoDiagnostic {
  const candidate = (error && typeof error === "object" ? error : {}) as Partial<RelGeoError>;
  const rawMessage = diagnosticSourceMessage(error, candidate);
  const message = safeDiagnosticMessage(error, candidate);
  const prefixedCode = rawMessage.match(ERROR_CODE_PREFIX)?.[1];
  const code = normalizeErrorCode(
    candidate.code ?? prefixedCode,
    rawMessage,
    options.fallbackCode,
  );
  const inferredPhase = inferPhase(code);
  const phase = RUNTIME_CODES.has(code) || code === "CONSTRAINT_VIOLATION"
    ? inferredPhase
    : isDiagnosticPhase(options.phase)
      ? options.phase
      : isDiagnosticPhase(candidate.phase)
        ? candidate.phase
        : inferredPhase;
  const severity = isDiagnosticSeverity(options.severity)
    ? options.severity
    : isDiagnosticSeverity(candidate.severity)
      ? candidate.severity
      : "error";

  return {
    code,
    message,
    path: candidate.path ?? options.path,
    objectId: candidate.objectId ?? options.objectId,
    dependencyChain: candidate.dependencyChain ?? options.dependencyChain,
    phase,
    severity,
    range: candidate.range ?? options.range,
    constraintType: candidate.constraintType,
    origin: candidate.origin,
    expected: candidate.expected,
    actual: candidate.actual,
  };
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Stable phase/path/code ordering for multi-diagnostic consumers. */
export function sortDiagnostics(diagnostics: RelGeoDiagnostic[]): RelGeoDiagnostic[] {
  const phaseOrder: Record<RelGeoDiagnosticPhase, number> = {
    parse: 0,
    validate: 1,
    resolve: 2,
    runtime: 3,
    constraint: 4,
  };
  const unique = new Map<string, RelGeoDiagnostic>();
  for (const diagnostic of diagnostics) {
    const stableValue = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stableValue);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
            .map(([key, entry]) => [key, stableValue(entry)]),
        );
      }
      return value;
    };
    const key = JSON.stringify([
      diagnostic.phase,
      diagnostic.severity,
      diagnostic.path ?? "",
      diagnostic.objectId ?? "",
      diagnostic.code,
      diagnostic.message,
      stableValue(diagnostic.range),
      stableValue(diagnostic.dependencyChain),
      diagnostic.constraintType ?? "",
      diagnostic.origin ?? "",
      stableValue(diagnostic.expected),
      stableValue(diagnostic.actual),
    ]);
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()].sort((left, right) => {
    const phaseDelta = phaseOrder[left.phase] - phaseOrder[right.phase];
    if (phaseDelta) return phaseDelta;
    const leftLine = left.range?.start.line ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.range?.start.line ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    const leftColumn = left.range?.start.column ?? Number.MAX_SAFE_INTEGER;
    const rightColumn = right.range?.start.column ?? Number.MAX_SAFE_INTEGER;
    if (leftColumn !== rightColumn) return leftColumn - rightColumn;
    const pathDelta = compareStrings(left.path ?? "", right.path ?? "");
    if (pathDelta) return pathDelta;
    const codeDelta = compareStrings(left.code, right.code);
    if (codeDelta) return codeDelta;
    return compareStrings(left.message, right.message);
  });
}

/**
 * Normalize and aggregate independent failures at a public boundary. This is
 * intentionally separate from strict resolver fail-fast behavior: adapters
 * such as language-service workers can collect failures from multiple passes
 * while retaining the same deterministic ordering and truncation contract.
 */
export function aggregateDiagnostics(
  errors: readonly unknown[],
  options: AggregateDiagnosticsOptions = {},
): RelGeoDiagnostic[] {
  const requestedMax = options.maxDiagnostics ?? 100;
  const maxDiagnostics = Number.isFinite(requestedMax)
    ? Math.max(0, Math.floor(requestedMax))
    : 100;
  const { maxDiagnostics: _ignored, ...diagnosticOptions } = options;
  return sortDiagnostics(
    errors.map((error) => toDiagnostic(error, diagnosticOptions)),
  ).slice(0, maxDiagnostics);
}

/**
 * Converts an uncategorized exception into the structured runtime error used
 * by the public resolver boundary. Existing ResolveError instances retain
 * their code/path payload and only receive missing fallback context.
 */
export function normalizeResolveError(
  error: unknown,
  objectId?: string,
  path?: string,
): ResolveError {
  const candidate = (error && typeof error === "object" ? error : {}) as Partial<RelGeoError>;
  const rawMessage = diagnosticSourceMessage(error, candidate);
  const message = safeDiagnosticMessage(error, candidate);
  const code = normalizeErrorCode(candidate.code, rawMessage, "RESOLVE_ERROR");
  const resolvedObjectId = candidate.objectId ?? objectId;
  const resolvedPath = candidate.path ?? path;

  if (
    error instanceof ResolveError &&
    error.code === code &&
    error.objectId === resolvedObjectId &&
    error.path === resolvedPath
  ) {
    return error;
  }

  const normalized = new ResolveError(message, code, resolvedObjectId, resolvedPath, candidate.range);
  normalized.dependencyChain = candidate.dependencyChain;
  return normalized;
}
