import { evaluateExpression } from "../../evaluator";
import { normalizeUnit } from "../../units";
import { ResolveContext, ResolveError } from "../types";
import { createEvalContext } from "../eval-context";
import { resolveObject } from "../objects";
import { sortObjects, sortUnified } from "../../graph";
import { evaluateSingleDerived } from "../values";
import { calculateBoundingBox } from "../geometry-utils";
import { applyObjectPlacementAndTransform } from "./utils";
import { resolveStructuredInherit } from "../inherit";
import { sortNodes } from "../../graph";

function componentParameterExpression(value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value) && "default" in (value as any)) {
        return (value as any).default;
    }
    return value;
}

function evaluateComponentParameter(
    value: unknown,
    evalCtx: ReturnType<typeof createEvalContext>,
    parameterType?: string,
): unknown {
    if (typeof value !== "string") return value;
    if (parameterType === "string" || parameterType === "enum") return value;
    try {
        return evaluateExpression(value, evalCtx);
    } catch (error) {
        // Untyped shorthand parameters may be string literals. Typed numeric
        // and geometric parameters must surface expression failures instead of
        // deferring an invalid value to a later object resolution.
        if (parameterType === undefined) return value;
        throw error;
    }
}

function getComponentParameterDependencies(value: unknown, parameterIds: Set<string>): string[] {
    if (typeof value !== "string") return [];
    const identifiers = value.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    return [...new Set(identifiers.filter((identifier) => parameterIds.has(identifier)))];
}

export function resolveComponent(
    id: string,
    obj: any,
    ctx: ResolveContext
): any {
    const compName = obj.use;
    if (!ctx.doc.components || !ctx.doc.components[compName]) {
        throw new ResolveError(`Component definition not found: ${compName}`, "COMPONENT_NOT_FOUND", id);
    }
    const compDef = ctx.doc.components[compName];

    // Create an evaluation context for the instance parameters
    const evalCtx = createEvalContext(ctx);
    const localScalars: Record<string, any> = {};

    // 1. Resolve component parameters in dependency order. A component
    // parameter is scoped to the instance, so defaults such as
    // `width: base * 2` must see `base` from the same component rather than
    // accidentally resolving against document globals.
    if (compDef.parameters) {
        const parameterIds = Object.keys(compDef.parameters);
        const effectiveValues = new Map<string, unknown>();
        for (const pName of parameterIds) {
            const definition = compDef.parameters[pName];
            const defaultValue = componentParameterExpression(definition);
            const suppliedValue = obj.params && Object.prototype.hasOwnProperty.call(obj.params, pName)
                ? obj.params[pName]
                : defaultValue;
            effectiveValues.set(pName, suppliedValue);
        }

        const parameterOrder = sortNodes(parameterIds, (pName) => {
            const value = effectiveValues.get(pName);
            return getComponentParameterDependencies(value, new Set(parameterIds));
        });

        for (const pName of parameterOrder) {
            const value = effectiveValues.get(pName);
            const definition = compDef.parameters[pName];
            const parameterType = definition && typeof definition === "object" && !Array.isArray(definition)
                ? (definition as any).type
                : undefined;
            const parameterEvalCtx = createEvalContext({
                ...ctx,
                scalars: { ...ctx.scalars, ...localScalars },
            });
            localScalars[pName] = evaluateComponentParameter(value, parameterEvalCtx, parameterType);
        }
    }

    // 2. Apply inherited structured parameter sources, then local instance parameters
    if (obj.params) {
        const inheritedParams = (obj.params as any).inherit !== undefined
            ? resolveStructuredInherit((obj.params as any).inherit, ctx)
            : {};

        for (const [pName, pVal] of Object.entries(inheritedParams)) {
            const definition = compDef.parameters?.[pName];
            const parameterType = definition && typeof definition === "object" && !Array.isArray(definition)
                ? (definition as any).type
                : undefined;
            const inheritedEvalCtx = createEvalContext({
                ...ctx,
                scalars: { ...ctx.scalars, ...localScalars },
            });
            const evaluated = evaluateComponentParameter(pVal, inheritedEvalCtx, parameterType);
            localScalars[pName] = evaluated;
        }

        for (const [pName, pVal] of Object.entries(obj.params)) {
            if (pName === "inherit") continue;
            const definition = compDef.parameters?.[pName];
            const parameterType = definition && typeof definition === "object" && !Array.isArray(definition)
                ? (definition as any).type
                : undefined;
            const localParamEvalCtx = createEvalContext({
                ...ctx,
                scalars: { ...ctx.scalars, ...localScalars },
            });
            const evaluated = evaluateComponentParameter(pVal, localParamEvalCtx, parameterType);
            localScalars[pName] = evaluated;
        }
    }

    const localResolvedInnerObjects: Record<string, any> = {};
    const nestedCtx: ResolveContext = {
        ...ctx,
        scalars: { ...ctx.scalars, ...localScalars },
        objects: { ...ctx.objects },
    };

    const hasDerived = !!(compDef.derived && Object.keys(compDef.derived).length > 0);

    // 3 & 4. Topologically sort and resolve inner objects (and derived)
    if (hasDerived) {
        const unifiedOrder = sortUnified(compDef.objects || {}, compDef.derived || {}, {
            ...ctx.doc,
            components: ctx.doc.components,
        });

        for (const node of unifiedOrder) {
            if (node.kind === "object") {
                const innerObj = compDef.objects[node.id];
                const prefixedId = `${id}.${node.id}`;
                
                const resolvedInner = resolveObject(prefixedId, innerObj, {
                    ...nestedCtx,
                    currentObjectId: prefixedId,
                });

                if (resolvedInner !== undefined) {
                    localResolvedInnerObjects[node.id] = resolvedInner;
                    nestedCtx.objects[node.id] = resolvedInner;
                    ctx.objects[prefixedId] = resolvedInner;
                }
            } else {
                // Derived node
                const evalCtx = createEvalContext(nestedCtx);
                const result = evaluateSingleDerived(node.id, compDef.derived![node.id], evalCtx);
                nestedCtx.scalars[node.id] = result;
            }
        }
    } else {
        const innerSortedIds = sortObjects(compDef.objects || {}, {
            ...ctx.doc,
            components: ctx.doc.components,
        });

        for (const innerId of innerSortedIds) {
            const innerObj = compDef.objects[innerId];
            const prefixedId = `${id}.${innerId}`;
            
            const resolvedInner = resolveObject(prefixedId, innerObj, {
                ...nestedCtx,
                currentObjectId: prefixedId,
            });

            if (resolvedInner !== undefined) {
                localResolvedInnerObjects[innerId] = resolvedInner;
                nestedCtx.objects[innerId] = resolvedInner;
                ctx.objects[prefixedId] = resolvedInner;
            }
        }
    }

    // 5. Build component exports as custom anchors
    const resolvedAnchors: Record<string, any> = {};
    const hasExports = compDef.exports && Object.keys(compDef.exports).length > 0;
    if (compDef.exports) {
        for (const [expName, expExpr] of Object.entries(compDef.exports)) {
            const expVal = evaluateExpression(expExpr as string, createEvalContext(nestedCtx));
            resolvedAnchors[expName] = expVal;
        }
    }

    // 5.5 Apply Placement and Transform to the Component
    const bbox = calculateBoundingBox(localResolvedInnerObjects);
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx, resolvedAnchors);
    const finalTransform = resolvedTransform || [];
    if (dx !== 0 || dy !== 0) {
        finalTransform.unshift({ type: "translate", x: dx, y: dy });
    }

    // 6. Return resolved component object
    return {
        id,
        type: "component",
        use: compName,
        meta: obj.meta,
        anchors: resolvedAnchors,
        hasExports,
        transform: finalTransform.length > 0 ? finalTransform : undefined,        
        children: Object.keys(localResolvedInnerObjects).map(innerId => `${id}.${innerId}`),
    };
}
