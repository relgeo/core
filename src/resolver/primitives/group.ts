import { ResolvedGroup, GroupObject } from "../../types";
import { ResolveContext } from "../types";
import { calculateBoundingBox } from "../geometry-utils";
import { wrapError, resolveCustomAnchors, applyObjectPlacementAndTransform } from "./utils";

export function resolveGroup(
    id: string, 
    obj: GroupObject, 
    ctx: ResolveContext,
    resolveChild?: (childId: string) => void
): ResolvedGroup {
    // 1. Resolve children first
    const children = obj.children || [];
    if (resolveChild) {
        children.forEach(childId => resolveChild(childId));
    }

    // 2. Calculate Bounding Box of children
    const childObjects: Record<string, any> = {};
    children.forEach(cid => {
        if (ctx.objects[cid]) childObjects[cid] = ctx.objects[cid];
    });

    const bbox = calculateBoundingBox(childObjects);

    // 3. Apply Placement and Transform
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx);

    // For groups, we must add the translate to the pipeline since they don't have x, y
    const finalTransform = resolvedTransform || [];
    if (dx !== 0 || dy !== 0) {
        finalTransform.unshift({ type: "translate", x: dx, y: dy });
    }

    const resolved: ResolvedGroup = {
        id,
        type: "group",
        children: [...children],
        transform: finalTransform.length > 0 ? finalTransform : undefined,
        meta: obj.meta,
    };

    resolved.anchors = resolveCustomAnchors(obj, resolved, ctx, bbox);
    return resolved;
}
