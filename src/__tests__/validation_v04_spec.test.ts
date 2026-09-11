import { describe, it, expect } from "vitest";
import { RelGeoDocument } from "../types";
import { resolveGeometry } from "../resolver";

describe("v0.4 Specification Validation and Error Mapping Tests", () => {
    it("accepts a document without objects and resolves to an empty scene", () => {
        const doc: RelGeoDocument = {
            version: "0.4",
        };

        const resolved = resolveGeometry(doc);
        expect(resolved.objects).toEqual({});
    });

    describe("Hole Topology Errors", () => {
        it("should throw HOLE_OUTSIDE_BOUNDARY when a hole is completely outside", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [50, 0] } },
                            { line: { to: [50, 50] } },
                            { line: { to: [0, 50] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [100, 100], to: [120, 100] } },
                                    { line: { to: [120, 120] } },
                                    { line: { to: [100, 120] } },
                                    { line: { to: [100, 100] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "HOLE_OUTSIDE_BOUNDARY" })
            );
        });

        it("should throw HOLE_OUTSIDE_BOUNDARY when a hole crosses (intersects) the boundary", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [50, 0] } },
                            { line: { to: [50, 50] } },
                            { line: { to: [0, 50] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [40, 40], to: [60, 40] } },
                                    { line: { to: [60, 60] } },
                                    { line: { to: [40, 60] } },
                                    { line: { to: [40, 40] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "HOLE_OUTSIDE_BOUNDARY" })
            );
        });

        it("should throw HOLE_OVERLAP when two holes overlap", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [100, 0] } },
                            { line: { to: [100, 100] } },
                            { line: { to: [0, 100] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [10, 10], to: [50, 10] } },
                                    { line: { to: [50, 50] } },
                                    { line: { to: [10, 50] } },
                                    { line: { to: [10, 10] } }
                                ]
                            },
                            {
                                segments: [
                                    { line: { from: [40, 40], to: [80, 40] } },
                                    { line: { to: [80, 80] } },
                                    { line: { to: [40, 80] } },
                                    { line: { to: [40, 40] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "HOLE_OVERLAP" })
            );
        });

        it("should throw HOLE_OVERLAP when two holes are nested", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    square: {
                        type: "path",
                        closed: true,
                        segments: [
                            { line: { from: [0, 0], to: [100, 0] } },
                            { line: { to: [100, 100] } },
                            { line: { to: [0, 100] } },
                            { line: { to: [0, 0] } }
                        ],
                        holes: [
                            {
                                segments: [
                                    { line: { from: [10, 10], to: [90, 10] } },
                                    { line: { to: [90, 90] } },
                                    { line: { to: [10, 90] } },
                                    { line: { to: [10, 10] } }
                                ]
                            },
                            {
                                segments: [
                                    { line: { from: [30, 30], to: [70, 30] } },
                                    { line: { to: [70, 70] } },
                                    { line: { to: [30, 70] } },
                                    { line: { to: [30, 30] } }
                                ]
                            }
                        ]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "HOLE_OVERLAP" })
            );
        });
    });

    describe("Boolean operation errors", () => {
        it("should throw INVALID_BOOLEAN_OPERATION when operation name is unknown", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    c1: { type: "circle", center: [0, 0], radius: 10 },
                    c2: { type: "circle", center: [5, 0], radius: 10 },
                    b1: {
                        type: "boolean",
                        operation: "invalid_op" as any,
                        shapes: ["c1", "c2"]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "INVALID_BOOLEAN_OPERATION" })
            );
        });

        it("should throw INVALID_BOOLEAN_OPERATION when base shape is missing for subtract", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    c2: { type: "circle", center: [5, 0], radius: 10 },
                    b1: {
                        type: "boolean",
                        operation: "subtract",
                        tools: ["c2"]
                    } as any
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "INVALID_BOOLEAN_OPERATION" })
            );
        });

        it("should throw INVALID_BOOLEAN_OPERATION when shapes is missing for union", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    b1: {
                        type: "boolean",
                        operation: "union"
                    } as any
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "INVALID_BOOLEAN_OPERATION" })
            );
        });

        it("should throw BOOLEAN_EMPTY_RESULT when intersect result has no area", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    c1: { type: "circle", center: [0, 0], radius: 5 },
                    c2: { type: "circle", center: [20, 0], radius: 5 },
                    b1: {
                        type: "boolean",
                        operation: "intersect",
                        shapes: ["c1", "c2"]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "BOOLEAN_EMPTY_RESULT" })
            );
        });
    });

    describe("tAtLength and Path Length errors", () => {
        it("should throw PATH_LENGTH_UNAVAILABLE when length is queried on invalid object", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    p1: { type: "point", at: "origin" },
                    line1: {
                        type: "line",
                        from: [0, 0],
                        to: ["length(p1)", 0]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "PATH_LENGTH_UNAVAILABLE" })
            );
        });

        it("should throw INVALID_T_AT_LENGTH when target length is negative", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    line1: { type: "line", from: [0, 0], to: [100, 0] },
                    p1: {
                        type: "point",
                        on: { path: { path: "line1", t: 0 } },
                        at: ["tAtLength(line1, -10) * 100", 0]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "INVALID_T_AT_LENGTH" })
            );
        });

        it("should throw INVALID_T_AT_LENGTH when target length exceeds total length", () => {
            const doc: RelGeoDocument = {
                version: "0.4",
                objects: {
                    line1: { type: "line", from: [0, 0], to: [100, 0] },
                    p1: {
                        type: "point",
                        on: { path: { path: "line1", t: 0 } },
                        at: ["tAtLength(line1, 150) * 100", 0]
                    }
                }
            };
            expect(() => resolveGeometry(doc)).toThrowError(
                expect.objectContaining({ code: "INVALID_T_AT_LENGTH" })
            );
        });
    });
});
