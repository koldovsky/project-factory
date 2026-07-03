// Fake adapters for the GREEN fixture: reference and local heights match at
// every breakpoint and the pixel diff scores 0.996 (above the 0.99 threshold).
const HEIGHTS = { desktop: 8275, mobile: 13742 };

export async function capture({ name, role }) {
  return {
    png: Buffer.from(`fake-png:${name}:${role}`),
    pageHeight: HEIGHTS[name],
    maskRects: [],
  };
}

export async function diff() {
  return { score: 0.996, diffPng: Buffer.from("fake-diff-png"), maskedCount: 0 };
}
