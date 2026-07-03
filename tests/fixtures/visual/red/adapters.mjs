// Fake capture/diff adapters for the RED fixture (injected via
// CHECK_VISUAL_FIDELITY_ADAPTERS). Heights reproduce the real pixel-case
// forensics numbers: desktop local 10190px vs live 8275px (+23.14%), mobile
// local 19899px vs live 13742px (+44.80%). Tablet heights match so the run
// reaches the pixel diff, which returns 0.93 < 0.99.
const HEIGHTS = {
  desktop: { reference: 8275, local: 10190 },
  mobile: { reference: 13742, local: 19899 },
  tablet: { reference: 5000, local: 5000 },
};

export async function capture({ name, role }) {
  return {
    png: Buffer.from(`fake-png:${name}:${role}`),
    pageHeight: HEIGHTS[name][role],
    maskRects: [],
  };
}

export async function diff() {
  return { score: 0.93, diffPng: Buffer.from("fake-diff-png"), maskedCount: 0 };
}
