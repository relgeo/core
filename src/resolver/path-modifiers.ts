import {
  applyCornerModifiers as geomApplyCornerModifiers,
  offsetPolyline as geomOffsetPolyline,
  validateNoSelfIntersection as geomValidateNoSelfIntersection,
  GeometryError,
} from "relgeo-geometry";
import { ResolveError } from "./types";

export type { Point2D, CornerModifiers, PathSegment, OffsetSide } from "relgeo-geometry";
export { computeFillet, computeChamfer } from "relgeo-geometry";

export function applyCornerModifiers(
  segments: any[],
  cornerLabels: string[],
  cornerMap: any,
  closed: boolean,
  pathId: string
): any[] {
  try {
    return geomApplyCornerModifiers(segments, cornerLabels, cornerMap, closed);
  } catch (err) {
    if (err instanceof GeometryError) {
      throw new ResolveError(
        err.message,
        err.code,
        pathId
      );
    }
    throw err;
  }
}

export function offsetPolyline(
  points: any[],
  distance: number,
  side: any,
  closed: boolean,
  pathId: string
): any[] {
  try {
    return geomOffsetPolyline(points, distance, side, closed);
  } catch (err) {
    if (err instanceof GeometryError) {
      throw new ResolveError(
        err.message,
        err.code,
        pathId
      );
    }
    throw err;
  }
}

export function validateNoSelfIntersection(
  points: any[],
  closed: boolean,
  pathId: string
): void {
  try {
    geomValidateNoSelfIntersection(points, closed);
  } catch (err) {
    if (err instanceof GeometryError) {
      throw new ResolveError(
        err.message,
        err.code,
        pathId
      );
    }
    throw err;
  }
}
