import type { LengthUnit, RelGeoMode, RelGeoError, RelGeoErrorCode, TextMetricsProvider } from "../types";

export interface ResolveOptions {
    profile?: string;
    targetUnit?: LengthUnit;
    overrides?: Record<string, any>;
    mode?: RelGeoMode;
    textMetrics?: TextMetricsProvider;
}

export interface ResolveContext {
    scalars: Record<string, any>;
    objects: Record<string, any>;
    targetUnit: LengthUnit;
    parentMap?: Map<string, string>;
    currentObjectId?: string;
    mode?: RelGeoMode;
    textMetrics: TextMetricsProvider;
    doc?: any;
}

export class ResolveError extends Error implements RelGeoError {
    constructor(
        message: string,
        public code?: RelGeoErrorCode | string,
        public objectId?: string,
        public path?: string
    ) {
        const fullMessage = code ? `${code}: ${message}` : message;
        super(fullMessage);
        this.message = fullMessage;
        this.name = "ResolveError";
    }
}