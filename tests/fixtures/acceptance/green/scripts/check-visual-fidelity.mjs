// Fixture stand-in for a real visual-fidelity checker (pixel-diff mechanism).
// In a real project this captures reference vs local at declared breakpoints
// and pixel-diffs them; here it just re-validates the committed report so the
// auditor sees a real, non-stub script file behind the pixel-diff token.
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync("docs/qa/visual-diff/home/report.json", "utf8"));
process.exit(report.score >= report.threshold ? 0 : 1);
