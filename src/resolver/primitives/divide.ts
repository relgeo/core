import { DivideObject, ResolvedObject } from "../../types";
import { evaluateExpression } from "../../evaluator";
import { createEvalContext } from "../eval-context";
import { ResolveContext } from "../types";

export function resolveDivide(
    id: string,
    obj: DivideObject,
    ctx: ResolveContext
): ResolvedObject {
    const evalCtx = createEvalContext(ctx);
    
    let countVal = obj.count;
    if (typeof countVal === "string") {
        countVal = evaluateExpression(countVal, evalCtx);
    }
    const count = Math.round(Number(countVal));
    
    if (isNaN(count) || count < 1) {
        throw new Error(`Invalid count in divide object: ${obj.count}`);
    }

    const targetId = obj.target;
    const targetObj = ctx.objects[targetId];
    if (!targetObj) {
        throw new Error(`Target object not found for divide: ${targetId}`);
    }

    // Determine if the target object is a closed path/shape
    const isClosed = 
        targetObj.type === "circle" || 
        targetObj.type === "rect" || 
        targetObj.type === "polygon" || 
        (targetObj.type === "path" && targetObj.closed === true);

    const points: { x: number; y: number }[] = [];

    if (isClosed) {
        // Closed path default exclude endpoint duplication:
        // Divide into 'count' intervals, generating points at t = i / count
        for (let i = 0; i < count; i++) {
            const t = i / count;
            const pt = evaluateExpression(`pointAt(${targetId}, ${t})`, evalCtx);
            if (pt && typeof pt === "object" && "x" in pt && "y" in pt) {
                points.push({ x: pt.x, y: pt.y });
            }
        }
    } else {
        // Open path (e.g. line, open path):
        // Divide into 'count - 1' intervals, generating points at t = i / (count - 1)
        const denom = count > 1 ? count - 1 : 1;
        for (let i = 0; i < count; i++) {
            const t = i / denom;
            const pt = evaluateExpression(`pointAt(${targetId}, ${t})`, evalCtx);
            if (pt && typeof pt === "object" && "x" in pt && "y" in pt) {
                points.push({ x: pt.x, y: pt.y });
            }
        }
    }

    // Register each point as a ResolvedPoint in ctx.objects under id[i]
    const childrenIds: string[] = [];
    for (let i = 0; i < points.length; i++) {
        const childId = `${id}[${i}]`;
        ctx.objects[childId] = {
            id: childId,
            type: "point",
            x: points[i].x,
            y: points[i].y,
            meta: obj.meta
        };
        childrenIds.push(childId);
    }

    // Return the collection object
    return {
        id,
        type: "collection",
        children: childrenIds,
        points: points,
        meta: obj.meta
    } as any;
}
