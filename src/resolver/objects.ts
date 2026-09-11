import type {
    RelGeoObject,
    ResolvedObject,
} from "../types";
import { ResolveContext } from "./types";
import { resolvePoint } from "./primitives/point";
import { 
    resolveRect, 
    resolveLine, 
    resolveCircle, 
    resolveEllipse,
    resolveArc,
    resolveQuadratic,
    resolveCubic,
    resolvePath, 
    resolveText,
    resolvePolygon,
    resolveBoolean
} from "./primitives/shapes";
import { resolveGroup } from "./primitives/group";
import { resolveClone } from "./primitives/clone";
import { resolveRepeat } from "./primitives/repeat";
import { resolveDivide } from "./primitives/divide";
import { resolveComponent } from "./primitives/component";
import { resolveDimension } from "./primitives/dimension";
import { resolveAnnotation } from "./primitives/annotation";
import { resolveGeometryOperationObject } from "./primitives/operation";
import { resolveStructuredInherit } from "./inherit";

function applyObjectStylePreset(
    obj: RelGeoObject,
    ctx: ResolveContext
): RelGeoObject {
    const metadataInheritOptions = {
        sources: [ctx.doc?.metaPresets, ctx.doc?.styles, ctx.scalars],
    };
    const presetName = (obj as any).metaPreset ?? (obj as any).style;
    const styleDef = presetName
        ? ctx.doc?.metaPresets?.[presetName] ?? ctx.doc?.styles?.[presetName]
        : undefined;
    if (!styleDef || typeof styleDef !== "object" || Array.isArray(styleDef)) {
        const inheritedMeta = (obj as any).meta?.inherit !== undefined
            ? resolveStructuredInherit((obj as any).meta.inherit, ctx, new Set(), metadataInheritOptions)
            : {};
        const localMeta = (obj as any).meta && typeof (obj as any).meta === "object"
            ? Object.fromEntries(Object.entries((obj as any).meta).filter(([key]) => key !== "inherit"))
            : obj.meta;
        const mergedMeta = {
            ...(inheritedMeta as Record<string, unknown>),
            ...((localMeta as Record<string, unknown>) ?? {}),
        };
        const hasMergedMeta = Object.keys(mergedMeta).length > 0;
        return {
            ...obj,
            meta: hasMergedMeta ? mergedMeta : obj.meta,
        };
    }

    const inheritedMeta = (obj as any).meta?.inherit !== undefined
        ? resolveStructuredInherit((obj as any).meta.inherit, ctx, new Set(), metadataInheritOptions)
        : {};
    const localMeta = (obj as any).meta && typeof (obj as any).meta === "object"
        ? Object.fromEntries(Object.entries((obj as any).meta).filter(([key]) => key !== "inherit"))
        : obj.meta;

    return {
        ...obj,
        meta: {
            ...(styleDef as Record<string, unknown>),
            ...(inheritedMeta as Record<string, unknown>),
            ...(localMeta as Record<string, unknown>),
        },
    };
}

/**
 * Dispatcher for object resolution.
 * This refactored version delegates to specific primitive resolvers.
 */
export function resolveObject(
    id: string,
    obj: RelGeoObject,
    ctx: ResolveContext,
    resolveChild?: (childId: string) => void
): ResolvedObject {
    const resolvedInput = applyObjectStylePreset(obj, ctx);

    switch (resolvedInput.type) {
        case "point":
            return resolvePoint(id, resolvedInput, ctx);
        case "rect":
            return resolveRect(id, resolvedInput, ctx);
        case "line":
            return resolveLine(id, resolvedInput, ctx);
        case "circle":
            return resolveCircle(id, resolvedInput, ctx);
        case "ellipse":
            return resolveEllipse(id, resolvedInput, ctx);
        case "arc":
            return resolveArc(id, resolvedInput, ctx);
        case "quadratic":
            return resolveQuadratic(id, resolvedInput, ctx);
        case "cubic":
            return resolveCubic(id, resolvedInput, ctx);
        case "text":
            return resolveText(id, resolvedInput, ctx);
        case "path":
            return resolvePath(id, resolvedInput, ctx);
        case "polygon":
            return resolvePolygon(id, resolvedInput, ctx);
        case "boolean":
            return resolveBoolean(id, resolvedInput, ctx as any);
        case "group":
            return resolveGroup(id, resolvedInput, ctx, resolveChild);
        case "clone":
            return resolveClone(id, resolvedInput, ctx);
        case "translate":
        case "rotate":
        case "scale":
        case "mirror":
        case "reverse":
        case "split":
            return resolveGeometryOperationObject(id, resolvedInput as any, ctx);
        case "repeat":
            return resolveRepeat(id, resolvedInput as any, ctx);
        case "divide":
            return resolveDivide(id, resolvedInput as any, ctx);
        case "collection":
            // Collection objects are already resolved and don't need further dispatcher resolution
            return resolvedInput as any;
        case "component":
            return resolveComponent(id, resolvedInput as any, ctx);
        case "dimension":
            return resolveDimension(id, resolvedInput as any, ctx);
        case "annotation":
            return resolveAnnotation(id, resolvedInput as any, ctx);
        default:
            throw new Error(`Unknown object type: ${(resolvedInput as any).type}`);
    }
}
