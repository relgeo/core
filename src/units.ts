import type { LengthUnit } from "./types";
import { CoreError } from "./errors";

const MM_TO_PX = 96 / 25.4;
const CM_TO_PX = 96 / 2.54;
const M_TO_PX = (96 / 2.54) * 100;
const IN_TO_PX = 96;
const DEG_TO_RAD = Math.PI / 180;
const NUMBER_PATTERN = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const UNIT_PATTERN = new RegExp(`^(${NUMBER_PATTERN})(px|mm|cm|m|in|%|deg|rad)$`);
const UNIT_OR_NUMBER_PATTERN = new RegExp(`^(${NUMBER_PATTERN})(px|mm|cm|m|in|%|deg|rad)?$`);
const KNOWN_UNIT_SUFFIX = /(?:px|mm|cm|m|in|%|deg|rad)$/i;

function invalidUnitValue(value: unknown): CoreError {
  return new CoreError(String(value), "INVALID_UNIT_VALUE", { phase: "validate" });
}

export function convertToPx(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidUnitValue(value);
    return value;
  }

  const normalized = value.trim();
  const match = normalized.match(UNIT_PATTERN);
  if (!match) {
    // Preserve the historical fallback for unknown unit suffixes such as
    // `100xyz`, while refusing malformed values that claim a known unit.
    if (KNOWN_UNIT_SUFFIX.test(normalized)) {
      throw invalidUnitValue(value);
    }
    const prefix = normalized.match(new RegExp(`^(${NUMBER_PATTERN})`));
    if (!prefix) throw invalidUnitValue(value);
    const num = Number(prefix[1]);
    if (!Number.isFinite(num)) throw invalidUnitValue(value);
    return num;
  }

  const num = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(num)) throw invalidUnitValue(value);

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
  if (!Number.isFinite(px)) throw invalidUnitValue(px);
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

  const strVal = String(value).trim();

  // Use a strict numeric grammar so malformed values such as `1.2.3cm`
  // cannot silently become a truncated parseFloat result.
  const match = strVal.match(UNIT_OR_NUMBER_PATTERN);
  if (!match) {
    if (/^[+-]?(?:\d|\.)/.test(strVal) && KNOWN_UNIT_SUFFIX.test(strVal)) {
      throw invalidUnitValue(value);
    }
    // Non-numeric values remain string literals (e.g. "red", "cross").
    return value;
  }

  const unit = match[2];
  if (!unit) {
    const num = Number(match[1]);
    if (!Number.isFinite(num)) throw invalidUnitValue(value);
    return num;
  }

  const pxValue = convertToPx(strVal);
  return convertFromPx(pxValue, targetUnit);
}
