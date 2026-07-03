// Fixture stand-in for a real vision-verify checker.
import { readFileSync } from "node:fs";
const verdict = JSON.parse(readFileSync("docs/qa/vision-report.json", "utf8"));
process.exit(verdict.met === true ? 0 : 1);
