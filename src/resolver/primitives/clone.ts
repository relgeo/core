import { ResolvedClone, CloneObject } from "../../types";
import { ResolveContext, ResolveError } from "../types";
import { calculateBoundingBox } from "../geometry-utils";
import { wrapError, resolveCustomAnchors, applyObjectPlacementAndTransform } from "./utils";

export function resolveClone(
    id: string, 
    obj: CloneObject, 
    ctx: ResolveContext
): ResolvedClone {
    const targetId = obj.of;
    const target = ctx.objects[targetId];

    if (!target) {
        throw new ResolveError(
            `Clone target "${targetId}" not found or not yet resolved.`,
            "UNKNOWN_REFERENCE",
            id,
            `objects.${id}.of`,
        );
    }

    // A clone is a virtual group containing the target.
    // In v0.2, the clone acts as the parent of the target in a virtual hierarchy.
    const childObjects: Record<string, any> = { [targetId]: target };
    const bbox = calculateBoundingBox(childObjects);

    // A clone uses the target's local bbox. Resolve its custom anchors before
    // placement so `place: { anchorName: ... }` can target the clone anchor.
    const localAnchorOwner = { id, type: "group", children: [targetId] };
    const localAnchors = resolveCustomAnchors(obj, localAnchorOwner, ctx, bbox);
    const { resolvedTransform, dx, dy } = applyObjectPlacementAndTransform(obj, bbox, ctx, localAnchors);

    // For clones, we must add the translate to the pipeline since they don't have x, y
    const finalTransform = resolvedTransform || [];
    if (dx !== 0 || dy !== 0) {
        finalTransform.unshift({ type: "translate", x: dx, y: dy });
    }

    const resolved: ResolvedClone = {
        id,
        type: "clone",
        of: targetId,
        children: [targetId], // Virtual child
        transform: finalTransform.length > 0 ? finalTransform : undefined,
        meta: obj.meta,
    };

    resolved.anchors = localAnchors;
    return resolved;
}
