import type { RelGeoDocument } from "../types";
import type { EvalContext } from "../evaluator";
import { normalizeUnit } from "../units";
import { evaluateExpression } from "../evaluator";
import { sortNodes } from "../graph";
import { getExpressionDependencies } from "./expression-deps";
import type { ResolveOptions } from "./types";
import { ResolveError } from "./types";
import { hasStructuredDiagnostic, normalizeErrorCode, stripErrorCodePrefix } from "../errors";

function wrapError(e: any, id: string, path: string): never {
    if (e instanceof ResolveError) throw e;
    if (hasStructuredDiagnostic(e)) throw e;
    const rawMessage = e instanceof Error ? e.message : String(e);
    const code = normalizeErrorCode(e?.code, rawMessage, "RESOLVE_ERROR");
    throw new ResolveError(stripErrorCodePrefix(rawMessage), code, id, path);
}

function applyOverridesAndNormalize(
    val: any,
    path: string,
    overrides: Record<string, any> | undefined,
    targetUnit: any
): any {
    if (overrides && overrides[path] !== undefined) {
        return overrides[path];
    }

    if (val === null || val === undefined) return val;

    if (val && typeof val === "object" && !Array.isArray(val) && "default" in val) {
        return applyOverridesAndNormalize(val.default, path, overrides, targetUnit);
    }

    if (Array.isArray(val)) {
        return val.map((item, idx) =>
            applyOverridesAndNormalize(item, `${path}[${idx}]`, overrides, targetUnit)
        );
    }

    if (val && typeof val === "object") {
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            res[k] = applyOverridesAndNormalize(v, `${path}.${k}`, overrides, targetUnit);
        }
        return res;
    }

    return normalizeUnit(val, targetUnit);
}

/**
 * Resolve parameters, constants, and scalar-only derived values.
 * Derived expressions that reference objects will be evaluated later
 * in the unified toposort loop in resolver/index.ts (with full context).
 */
export function resolveValues(
    doc: RelGeoDocument,
    options: ResolveOptions = {}
): Record<string, any> {
    const targetUnit = options.targetUnit || doc.scene?.unit || "px";
    const scalars: Record<string, any> = {};

    if (options.profile !== undefined && !Object.prototype.hasOwnProperty.call(doc.profiles || {}, options.profile)) {
        throw new ResolveError(
            `Unknown profile "${options.profile}"`,
            "UNKNOWN_REFERENCE",
            undefined,
            "profile",
        );
    }

    // 1. Resolve Parameters
    if (doc.parameters) {
        for (const [id, param] of Object.entries(doc.parameters)) {
            let val = param && typeof param === "object" && !Array.isArray(param) && "default" in param
                ? (param as any).default
                : param;

            if (options.profile && doc.profiles?.[options.profile]) {
                const profileVal = doc.profiles[options.profile][id];
                if (profileVal !== undefined) {
                    val = profileVal;
                }
            }

            try {
                if (options.overrides && options.overrides[id] !== undefined) {
                    scalars[id] = options.overrides[id];
                } else {
                    scalars[id] = applyOverridesAndNormalize(val, id, options.overrides, targetUnit);
                }
            } catch (e) {
                wrapError(e, id, `parameters.${id}`);
            }
        }
    }

    // 2. Resolve Constants
    if (doc.constants) {
        for (const [id, constant] of Object.entries(doc.constants)) {
            const val = constant && typeof constant === "object" && !Array.isArray(constant) && "value" in constant
                ? (constant as any).value
                : constant;

            try {
                scalars[id] = normalizeUnit(val, targetUnit);
            } catch (e) {
                wrapError(e, id, `constants.${id}`);
            }
        }
    }

    // 3. Resolve Derived (scalar-only pass — no objects context)
    // This handles pure scalar derived (e.g. "base * 2") and structured scalar access
    // (e.g. "boltPattern.diameter * 2"). Derived that reference objects are skipped here
    // and will be resolved later in the unified toposort loop.
    if (doc.derived) {
        const derivedIds = new Set(Object.keys(doc.derived));

        // Build scalar-aware EvalContext (no objects, but supports member/index on scalars)
        const makeScalarEvalCtx = (): import("../evaluator").EvalContext => ({
            scalars,
            targetUnit,
            get: (name: string) => {
                if (scalars[name] !== undefined) {
                    const v = scalars[name];
                    if (v && typeof v === "object" && "x" in v && "y" in v) return { type: "point", value: v };
                    if (Array.isArray(v)) return { type: "array", value: v };
                    if (v && typeof v === "object") return { type: "object", value: v };
                    if (typeof v === "number") return { type: "number", value: v };
                    if (typeof v === "boolean") return { type: "boolean", value: v };
                    if (typeof v === "string") return { type: "string", value: v };
                }
                return undefined;
            },
            getMember: (obj, member) => {
                const val = obj.value;
                if (val && typeof val === "object" && member in val) {
                    const m = val[member];
                    if (typeof m === "number") return { type: "number", value: m };
                    if (Array.isArray(m)) return { type: "array", value: m };
                    if (m && typeof m === "object") return { type: "object", value: m };
                    return { type: "string", value: String(m) };
                }
                return undefined;
            },
            getIndex: (arr, index) => {
                const val = arr.value;
                if (Array.isArray(val)) {
                    const item = val[index as number];
                    if (item !== undefined) {
                        if (typeof item === "number") return { type: "number", value: item };
                        return { type: "string", value: String(item) };
                    }
                }
                return undefined;
            },
        });

        // Sort derived by intra-derived dependencies only (for cycle detection)
        const sortedDerivedIds = sortNodes(Object.keys(doc.derived), (id) => {
            const def = doc.derived![id];
            const expr = def && typeof def === "object" && !Array.isArray(def) && "value" in (def as any)
                ? (def as any).value
                : def;
            return getExpressionDependencies(expr).filter(dep => derivedIds.has(dep) && dep !== id);
        });

        for (const id of sortedDerivedIds) {
            const def = doc.derived![id];
            const expr = def && typeof def === "object" && !Array.isArray(def) && "value" in (def as any)
                ? (def as any).value
                : def;
            try {
                scalars[id] = evaluateExpression(expr, makeScalarEvalCtx());
            } catch (_e) {
                // Silently skip derived that need objects context — they will be resolved
                // in the unified toposort loop after objects are resolved.
                // Only surface true errors (syntax, division by zero, etc.).
                const e = _e as any;
                if (e instanceof ResolveError) {
                    // Re-throw cycle errors immediately (they come from sortNodes above)
                    if (e.code === "CIRCULAR_DEPENDENCY") throw e;
                    // Otherwise skip (expression may need objects)
                } else {
                    const msg: string = e.message ?? "";
                    const needsObjects =
                        msg.includes("Unknown identifier") ||
                        msg.includes("Cannot resolve geometry function") ||
                        msg.includes("Cannot read");
                    if (!needsObjects) {
                        wrapError(e, id, `derived.${id}`);
                    }
                }
                // else: skip — will be resolved in unified loop when objects are available
            }
        }
    }

    return scalars;
}


/**
 * Evaluate a single derived expression and store the result in scalars.
 * Called from the unified resolver loop after dependent objects/derived are resolved.
 */
export function evaluateSingleDerived(
    id: string,
    def: unknown,
    evalCtx: EvalContext,
): any {
    const expr = def && typeof def === "object" && !Array.isArray(def) && "value" in (def as any)
        ? (def as any).value
        : def;

    try {
        return evaluateExpression(expr, evalCtx);
    } catch (e) {
        wrapError(e, id, `derived.${id}`);
    }
}
