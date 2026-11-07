export const curveEnvelopeFixture = {
  quadratic: {
    version: 0.5,
    objects: {
      curve: {
        type: "path",
        segments: [{ quadratic: { from: [0, 0], cp: [50, 100], to: [100, 0] } }],
      },
      marker: {
        type: "rect",
        size: [10, 10],
        place: { center: "curve.center" },
      },
    },
  },
  cubic: {
    version: 0.5,
    objects: {
      curve: {
        type: "path",
        segments: [{ cubic: {
          from: [0, 0],
          cp1: [0, 100],
          cp2: [100, 100],
          to: [100, 0],
        } }],
      },
      marker: {
        type: "rect",
        size: [10, 10],
        place: { center: "curve.center" },
      },
    },
  },
} as const;
