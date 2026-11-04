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
  "INVALID_T_AT_LENGTH",
  "PATH_LENGTH_UNAVAILABLE",
  "INVALID_RESOLVED_SCENE",
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
  "INVALID_INHERIT_TARGET",
  "INHERIT_TARGET_NOT_FOUND",
  "CIRCULAR_INHERIT",
  "INVALID_REPEAT_COUNT",
  "INVALID_GRID_SPACING",
  "OVER_CONSTRAINED_REPEAT_LAYOUT",
  "INVALID_REPEAT_ALONG_TARGET",
  "INVALID_REPEAT_ALONG_SPACING",
  "INVALID_FIXED_DISTANCE",
  "INVALID_UNIT_VALUE",
  "ELLIPSE_INVALID_RADIUS",
  "ELLIPSE_SIZE_CONFLICT",
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

export interface CoreErrorOptions {
  phase: RelGeoDiagnosticPhase;
  severity?: RelGeoDiagnosticSeverity;
  path?: string;
  objectId?: string;
  dependencyChain?: string[];
  range?: SourceRange;
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
  if (lower.includes("division by zero")) return "DIVISION_BY_ZERO";
  if (lower.includes("unknown identifier")) return "UNKNOWN_IDENTIFIER";
  if (lower.includes("unknown anchor")) return "UNKNOWN_ANCHOR";
  if (lower.includes("unknown reference")) return "UNKNOWN_REFERENCE";
  if (lower.includes("unknown function")) return "UNKNOWN_FUNCTION";
  if (lower.includes("invalid object type")) return "INVALID_OBJECT_TYPE";
  if (lower.includes("unknown field")) return "UNKNOWN_FIELD";
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
    this.phase = options.phase;
    this.severity = options.severity ?? "error";
    this.path = options.path;
    this.objectId = options.objectId;
    this.dependencyChain = options.dependencyChain;
    this.range = options.range;
  }
}

/** Convert any public-boundary failure into the stable diagnostic shape. */
export function toDiagnostic(error: unknown, options: DiagnosticOptions = {}): RelGeoDiagnostic {
  const candidate = (error && typeof error === "object" ? error : {}) as Partial<RelGeoError>;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const prefixedCode = rawMessage.match(ERROR_CODE_PREFIX)?.[1];
  const code = normalizeErrorCode(
    candidate.code ?? prefixedCode,
    rawMessage,
    options.fallbackCode,
  );
  const inferredPhase = inferPhase(code);
  const phase = RUNTIME_CODES.has(code) || code === "CONSTRAINT_VIOLATION"
    ? inferredPhase
    : options.phase ?? candidate.phase ?? inferredPhase;
  const severity = candidate.severity ?? options.severity ?? "error";

  return {
    code,
    message: stripErrorCodePrefix(rawMessage),
    path: candidate.path ?? options.path,
    objectId: candidate.objectId ?? options.objectId,
    dependencyChain: candidate.dependencyChain ?? options.dependencyChain,
    phase,
    severity,
    range: candidate.range ?? options.range,
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
    const range = diagnostic.range
      ? `${diagnostic.range.start.line}:${diagnostic.range.start.column}`
      : "";
    const key = [
      diagnostic.phase,
      diagnostic.path ?? "",
      diagnostic.code,
      diagnostic.message,
      range,
    ].join("\u0000");
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
  const rawMessage = error instanceof Error ? error.message : String(error);
  const code = normalizeErrorCode(candidate.code, rawMessage, "RESOLVE_ERROR");
  const message = stripErrorCodePrefix(rawMessage);
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
