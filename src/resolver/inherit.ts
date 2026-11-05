import { ResolveContext, ResolveError } from "./types";

function isStructuredMap(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

interface StructuredInheritOptions {
    sources?: Array<Record<string, unknown> | undefined>;
}

function getStructuredSources(
    ctx: ResolveContext,
    options?: StructuredInheritOptions,
): Array<Record<string, unknown> | undefined> {
    return options?.sources ?? [ctx.scalars];
}

function lookupStructuredSource(
    ref: string,
    ctx: ResolveContext,
    options?: StructuredInheritOptions,
): Record<string, unknown> {
    for (const sourceMap of getStructuredSources(ctx, options)) {
        const source = sourceMap?.[ref];
        if (source === undefined) {
            continue;
        }
        if (!isStructuredMap(source)) {
            throw new ResolveError(`Inherit source must be a structured map: ${ref}`, "INVALID_INHERIT_TARGET");
        }
        return source;
    }
    throw new ResolveError(`Inherit source not found: ${ref}`, "INHERIT_TARGET_NOT_FOUND");
}

function shallowMergeMaps(sources: Array<Record<string, unknown>>): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const source of sources) {
        for (const [key, value] of Object.entries(source)) {
            if (key in merged && valueKind(merged[key]) !== valueKind(value)) {
                throw new ResolveError(
                    `Inherited key "${key}" has incompatible value types`,
                    "INHERIT_TYPE_CONFLICT",
                    undefined,
                    `inherit.${key}`,
                );
            }
        }
        Object.assign(merged, source);
    }
    return merged;
}

function valueKind(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function resolveStructuredSource(
    ref: string,
    ctx: ResolveContext,
    seen: Set<string>,
    options?: StructuredInheritOptions,
): Record<string, unknown> {
    if (seen.has(ref)) {
        throw new ResolveError(`Circular inherit detected at: ${ref}`, "CIRCULAR_INHERIT");
    }

    seen.add(ref);
    try {
        const source = lookupStructuredSource(ref, ctx, options);
        const inheritSpec = source.inherit;
        const localEntries = Object.fromEntries(
            Object.entries(source).filter(([key]) => key !== "inherit"),
        );

        if (inheritSpec === undefined) {
            return localEntries;
        }

        const inherited = resolveStructuredInherit(inheritSpec, ctx, seen, options);
        return {
            ...inherited,
            ...localEntries,
        };
    } finally {
        seen.delete(ref);
    }
}

export function resolveStructuredInherit(
    inheritSpec: unknown,
    ctx: ResolveContext,
    seen: Set<string> = new Set(),
    options?: StructuredInheritOptions,
): Record<string, unknown> {
    if (inheritSpec === undefined) return {};

    const refs = Array.isArray(inheritSpec) ? inheritSpec : [inheritSpec];
    const sources: Array<Record<string, unknown>> = [];

    for (const ref of refs) {
        if (typeof ref !== "string" || ref.trim() === "") {
            throw new ResolveError("Inherit references must be non-empty strings", "INVALID_INHERIT_TARGET");
        }
        sources.push(resolveStructuredSource(ref, ctx, seen, options));
    }

    return shallowMergeMaps(sources);
}
