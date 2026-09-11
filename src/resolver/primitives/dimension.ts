import { evaluateExpression } from "../../evaluator";
import { normalizeUnit } from "../../units";
import { ResolveContext, ResolveError } from "../types";
import { createEvalContext } from "../eval-context";
import { resolveAnchorValue } from "../anchors";
import type { DimensionObject, ResolvedDimension } from "../../types";
import { wrapError } from "./utils";

export function resolveDimension(
    id: string,
    obj: DimensionObject,
    ctx: ResolveContext
): ResolvedDimension {
    const evalCtx = createEvalContext(ctx);

    try {
        let distance: number | undefined;
        let angle: number | undefined;
        let fromPt: { x: number; y: number } | undefined;
        let toPt: { x: number; y: number } | undefined;
        let formattedVal = "";
        let formattedRadius = "";
        let formattedDiameter = "";
        let formattedAngle = "";

        if (obj.kind === "linear") {
            if (obj.from === undefined || obj.to === undefined) {
                throw new ResolveError("Linear dimension requires both 'from' and 'to'", "DIMENSION_TARGET_INVALID", id);
            }
            let p1: any;
            let p2: any;
            try {
                p1 = resolveAnchorValue(obj.from, ctx);
                p2 = resolveAnchorValue(obj.to, ctx);
            } catch (e: any) {
                throw new ResolveError(e.message || "Invalid targets for linear dimension", "DIMENSION_TARGET_INVALID", id);
            }
            if (!p1 || typeof p1 !== "object" || p1.x === undefined || p1.y === undefined ||
                !p2 || typeof p2 !== "object" || p2.x === undefined || p2.y === undefined) {
                throw new ResolveError("Invalid target points for linear dimension", "DIMENSION_TARGET_INVALID", id);
            }
            fromPt = p1;
            toPt = p2;
            distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            formattedVal = `${Math.round(distance * 100) / 100}${ctx.targetUnit}`;
        } else if (obj.kind === "radius" || obj.kind === "diameter") {
            if (obj.target === undefined) {
                throw new ResolveError("Radius/Diameter dimension requires 'target'", "DIMENSION_TARGET_INVALID", id);
            }
            const targetObj = ctx.objects[obj.target];
            if (!targetObj) {
                throw new ResolveError(`Unknown target reference: ${obj.target}`, "DIMENSION_TARGET_INVALID", id);
            }
            let radius: number | undefined;
            if (targetObj.radius !== undefined) {
                radius = targetObj.radius;
            } else if (targetObj.r !== undefined) {
                radius = targetObj.r;
            } else if (targetObj.type === "circle" && targetObj.radius !== undefined) {
                radius = targetObj.radius;
            }
            if (radius === undefined) {
                throw new ResolveError(`Target object "${obj.target}" does not have a radius`, "DIMENSION_TARGET_INVALID", id);
            }

            if (obj.kind === "radius") {
                distance = radius;
                formattedVal = `${Math.round(distance * 100) / 100}${ctx.targetUnit}`;
                formattedRadius = formattedVal;
            } else {
                distance = radius * 2;
                formattedVal = `${Math.round(distance * 100) / 100}${ctx.targetUnit}`;
                formattedDiameter = formattedVal;
            }
        } else if (obj.kind === "angle") {
            if (obj.between === undefined || !Array.isArray(obj.between) || obj.between.length !== 2) {
                throw new ResolveError("Angle dimension requires 'between' with exactly 2 lines", "DIMENSION_TARGET_INVALID", id);
            }
            const line1 = ctx.objects[obj.between[0]];
            const line2 = ctx.objects[obj.between[1]];
            if (!line1 || line1.type !== "line" || !line2 || line2.type !== "line") {
                throw new ResolveError("Target objects for angle dimension must be lines", "DIMENSION_TARGET_INVALID", id);
            }
            const x1_1 = line1.x1 ?? line1.from?.x ?? 0;
            const y1_1 = line1.y1 ?? line1.from?.y ?? 0;
            const x2_1 = line1.x2 ?? line1.to?.x ?? 0;
            const y2_1 = line1.y2 ?? line1.to?.y ?? 0;

            const x1_2 = line2.x1 ?? line2.from?.x ?? 0;
            const y1_2 = line2.y1 ?? line2.from?.y ?? 0;
            const x2_2 = line2.x2 ?? line2.to?.x ?? 0;
            const y2_2 = line2.y2 ?? line2.to?.y ?? 0;

            const a1 = Math.atan2(y2_1 - y1_1, x2_1 - x1_1);
            const a2 = Math.atan2(y2_2 - y1_2, x2_2 - x1_2);

            let diff = Math.abs(a2 - a1) * (180 / Math.PI);
            if (diff > 180) diff = 360 - diff;
            angle = Math.round(diff * 100) / 100;
            formattedVal = `${angle}°`;
            formattedAngle = formattedVal;
        } else {
            throw new ResolveError(`Unknown dimension kind: ${obj.kind}`, "DIMENSION_TARGET_INVALID", id);
        }

        let text: string = obj.text || "";
        if (text === "") {
            if (obj.kind === "linear") text = "{distance}";
            else if (obj.kind === "radius") text = "R{radius}";
            else if (obj.kind === "diameter") text = "Ø{diameter}";
            else if (obj.kind === "angle") text = "{angle}°";
        }

        if (typeof text === "string") {
            text = text.replace(/\{([^{}]+)\}/g, (_match, expr) => {
                const trimmed = expr.trim();
                if (trimmed === "distance") return formattedVal;
                if (trimmed === "radius") return formattedRadius || formattedVal;
                if (trimmed === "diameter") return formattedDiameter || formattedVal;
                if (trimmed === "angle") return formattedAngle || formattedVal;

                const val = evaluateExpression(trimmed, evalCtx);
                return String(val);
            });
        }

        const offset = obj.offset !== undefined ? normalizeUnit(evaluateExpression(obj.offset, evalCtx), ctx.targetUnit) : undefined;

        const resolved: ResolvedDimension = {
            id,
            type: "dimension",
            kind: obj.kind,
            text,
            meta: obj.meta ? { ...obj.meta, role: obj.meta.role || "dimension" } : { role: "dimension" },
        };

        if (fromPt) resolved.from = fromPt;
        if (toPt) resolved.to = toPt;
        if (offset !== undefined) resolved.offset = offset;
        if (obj.target) resolved.target = obj.target;
        if (obj.between) resolved.between = obj.between;
        if (distance !== undefined) resolved.distance = distance;
        if (angle !== undefined) resolved.angle = angle;

        return resolved;
    } catch (e: any) {
        if (e instanceof ResolveError) throw e;
        wrapError(e, id, "dimension resolution");
    }
}
