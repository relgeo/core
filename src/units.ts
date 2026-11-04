import type { LengthUnit } from "./types";
import { CoreError } from "./errors";

const MM_TO_PX = 96 / 25.4;
const CM_TO_PX = 96 / 2.54;
const M_TO_PX = (96 / 2.54) * 100;
const IN_TO_PX = 96;
const DEG_TO_RAD = Math.PI / 180;

export function convertToPx(value: string | number): number {
  if (typeof value === "number") return value;

  const match = value.match(/^([\d.-]+)(px|mm|cm|m|in|%|deg|rad)$/);
  if (!match) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new CoreError(value, "INVALID_UNIT_VALUE", { phase: "validate" });
    }
    return num;
  }

  const num = parseFloat(match[1]);
  const unit = match[2];

  if (unit === "%") {
    return num / 100;
  }

  switch (unit) {
    case "mm":
      return num * MM_TO_PX;
    case "cm":
      return num * CM_TO_PX;
    case "m":
      return num * M_TO_PX;
    case "in":
      return num * IN_TO_PX;
    case "deg":
      return num * DEG_TO_RAD;
    case "rad":
      return num;
    case "px":
    default:
      return num;
  }
}

export function convertFromPx(px: number, targetUnit: LengthUnit): number {
  switch (targetUnit) {
    case "mm":
      return px / MM_TO_PX;
    case "cm":
      return px / CM_TO_PX;
    case "m":
      return px / M_TO_PX;
    case "in":
      return px / IN_TO_PX;
    case "px":
    default:
      return px;
  }
}

/**
 * Normalizes any value with unit to a number in the target unit.
 * If the value has no unit, it is assumed to be already in the target unit.
 * Recursively normalizes arrays and objects.
 */
export function normalizeUnit(
  value: any,
  targetUnit: LengthUnit = "px"
): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnit(item, targetUnit));
  }

  if (typeof value === "object") {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = normalizeUnit(v, targetUnit);
    }
    return res;
  }

  const strVal = String(value);

  // Use strict regex to check if it's a number with optional unit
  const match = strVal.match(/^([+-]?[\d.-]+)(px|mm|cm|m|in|%|deg|rad)?$/);
  if (!match) {
    // Not a valid number+unit format, might be a string literal (e.g. "red", "cross")
    // Let's check if it's a pure number without unit first, just in case
    const num = parseFloat(strVal);
    if (!isNaN(num) && String(num) === strVal) {
      return num;
    }
    return value;
  }

  const unit = match[2];
  if (!unit) {
    return parseFloat(match[1]);
  }

  const pxValue = convertToPx(strVal);
  return convertFromPx(pxValue, targetUnit);
}
