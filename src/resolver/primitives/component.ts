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

    // 1. Load default parameters from the component definition
    if (compDef.parameters) {
        for (const [pName, pDef] of Object.entries(compDef.parameters)) {
            let defaultVal = pDef;
            if (pDef && typeof pDef === "object" && !Array.isArray(pDef)) {
                defaultVal = (pDef as any).default;
            }
            let evaluated = typeof defaultVal === "string" ? evaluateExpression(defaultVal, evalCtx) : defaultVal;
            if (typeof evaluated === "string" && /[a-z%]+$/i.test(evaluated)) {
                evaluated = evaluateExpression(evaluated, evalCtx);
            }
            localScalars[pName] = evaluated;
        }
    }

    // 2. Apply inherited structured parameter sources, then local instance parameters
    if (obj.params) {
        const inheritedParams = (obj.params as any).inherit !== undefined
            ? resolveStructuredInherit((obj.params as any).inherit, ctx)
            : {};

        for (const [pName, pVal] of Object.entries(inheritedParams)) {
            let evaluated = typeof pVal === "string" ? evaluateExpression(pVal, evalCtx) : pVal;
            if (typeof evaluated === "string" && /[a-z%]+$/i.test(evaluated)) {
                evaluated = evaluateExpression(evaluated, evalCtx);
            }
            localScalars[pName] = evaluated;
        }

        for (const [pName, pVal] of Object.entries(obj.params)) {
            if (pName === "inherit") continue;
            let evaluated = typeof pVal === "string" ? evaluateExpression(pVal, evalCtx) : pVal;
            if (typeof evaluated === "string" && /[a-z%]+$/i.test(evaluated)) {
                evaluated = evaluateExpression(evaluated, evalCtx);
            }
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
