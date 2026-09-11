import { describe, it, expect } from "vitest";
import { resolvePath } from "../resolver/primitives/shapes";
import { ResolveContext } from "../resolver/types";

const mockCtx: ResolveContext = {
    scalars: {},
    objects: {},
    targetUnit: "mm",
    mode: "compile",
    textMetrics: {
        measure: () => ({ width: 10, height: 10, ascent: 8, descent: 2 })
    }
};

describe("Path Fillet with Segments", () => {
    it("should apply fillet when using segments", () => {
        const obj: any = {
            version: "0.2",
            type: "path",
            closed: true,
            segments: [
                { line: { from: [0, 0], to: [150, 0] } },
                { line: { to: [150, 40] } },
                { line: { to: [40, 40] } },
                { line: { to: [40, 100] } },
                { line: { to: [0, 100] } },
                { line: { to: [0, 0] } }
            ],
            corners: {
                "2": { fillet: 5 },
                "4": { fillet: 5 }
            }
        };

        const resolved = resolvePath("bracketSiku", obj, mockCtx);
        
        // Count segments. Original 6 lines.
        // Corner 2 (P2) is between seg 1 and 2. It should be replaced by an arc + shortened lines.
        // Corner 4 (P4) is between seg 3 and 4. Same.
        // Total should be 6 - 2 + 2 = 6 segments? No.
        // Each fillet adds 1 arc and keeps the 2 lines (but shortened).
        // Wait, applyCornerModifiers pushes the shortened incoming line, then the arc, then shortens the next line.
        // For corner 2: result gets shortened Seg 1, then Arc, then Seg 2 is shortened for next loop.
        // Total segments should be 6 (original) + 2 (arcs) = 8.
        expect(resolved.segments?.length).toBe(8);
        
        const arc2 = resolved.segments?.find(s => s.type === "arc" && s.radius === 5);
        expect(arc2).toBeDefined();
    });
});
