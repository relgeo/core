import { evaluateExpression } from "../../evaluator";
import { ResolveContext, ResolveError } from "../types";
import { createEvalContext } from "../eval-context";
import { resolveAnchorValue } from "../anchors";
import type { AnnotationObject, ResolvedAnnotation } from "../../types";
import { wrapError, applyObjectPlacementAndTransform } from "./utils";
import { getObjectBoundingBox } from "../geometry-utils";

export function resolveAnnotation(
    id: string,
    obj: AnnotationObject,
    ctx: ResolveContext
): ResolvedAnnotation {
    const evalCtx = createEvalContext(ctx);

    try {
        if (obj.target !== undefined) {
            const targetObj = ctx.objects[obj.target];
            if (!targetObj) {
                throw new ResolveError(`Unknown target reference: ${obj.target}`, "ANNOTATION_TARGET_INVALID", id);
            }
        }

        let text = obj.text || "";
        if (typeof obj.text === "string") {
            try {
                text = obj.text.replace(/\{([^{}]+)\}/g, (_match, expr) => {
                    const value = evaluateExpression(expr.trim(), evalCtx);
                    return String(value);
                });
            } catch (e) {
                if (ctx.mode !== "editor") wrapError(e, id, "text");
            }
        }

        let leader: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
        if (obj.leader) {
            let pFrom: any;
            let pTo: any;
            try {
                pFrom = resolveAnchorValue(obj.leader.from, ctx);
                pTo = resolveAnchorValue(obj.leader.to, ctx);
            } catch (e: any) {
                throw new ResolveError(e.message || "Invalid targets for leader line", "ANNOTATION_TARGET_INVALID", id);
            }
            if (!pFrom || typeof pFrom !== "object" || pFrom.x === undefined || pFrom.y === undefined ||
                !pTo || typeof pTo !== "object" || pTo.x === undefined || pTo.y === undefined) {
                throw new ResolveError("Invalid target points for leader line", "ANNOTATION_TARGET_INVALID", id);
            }
            leader = {
                from: pFrom,
                to: pTo
            };
        }

function parseFontSize(val: string | number | undefined, defaultVal: number): number {
    if (typeof val === "number") return val;
    if (typeof val !== "string") return defaultVal;
    const clean = val.toLowerCase().trim();
    const num = parseFloat(clean);
    if (isNaN(num)) return defaultVal;
    if (clean.endsWith("pt")) return num * 1.333333;
    if (clean.endsWith("em") || clean.endsWith("rem")) return num * 16;
    return num;
}

        const fontSize = parseFontSize(obj.meta?.fontSize as string | number | undefined, 12);
        const fontFamily = typeof obj.meta?.fontFamily === "string" ? obj.meta.fontFamily : undefined;
        const fontWeight = obj.meta?.fontWeight as string | number | undefined;
        const fontStyle = obj.meta?.fontStyle as "normal" | "italic" | "oblique" | undefined;
        const lineHeight = parseFontSize(obj.meta?.lineHeight as string | number | undefined, 1);

        const metrics = ctx.textMetrics.measure({
            content: text,
            fontSize: isNaN(fontSize) ? 12 : fontSize,
            fontFamily,
            fontWeight,
            fontStyle,
            lineHeight: isNaN(lineHeight) ? 1 : lineHeight
        });

        const width = metrics.width;
        const height = metrics.height;

        let placeInfo: any = undefined;
        if (obj.place) {
            const bbox = { x: 0, y: 0, width, height };

            const { dx, dy } = applyObjectPlacementAndTransform(
                obj,
                bbox,
                ctx
            );
            placeInfo = { x: dx, y: dy, width, height };
        } else if (obj.target && !leader) {
            const targetBbox = getObjectBoundingBox(obj.target, ctx.objects);
            const gap = Math.max((isNaN(fontSize) ? 12 : fontSize) * 0.5, 5);
            placeInfo = {
                x: targetBbox.x + targetBbox.width + gap,
                y: targetBbox.y + (targetBbox.height - height) / 2,
                width,
                height,
            };
        }

        const resolved: ResolvedAnnotation = {
            id,
            type: "annotation",
            text,
            meta: obj.meta ? { ...obj.meta, role: obj.meta.role || "annotation" } : { role: "annotation" },
        };

        if (obj.target) resolved.target = obj.target;
        if (leader) resolved.leader = leader;
        if (placeInfo) resolved.place = placeInfo;

        return resolved;
    } catch (e: any) {
        if (e instanceof ResolveError) throw e;
        wrapError(e, id, "annotation resolution");
    }
}
