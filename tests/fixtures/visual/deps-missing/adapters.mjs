// Simulates playwright being absent: the capture adapter throws the same
// shaped error the real lazy-import path produces. The check must FAIL
// (exit 1) with install instructions — a missing tool is never a pass.
export async function capture() {
  const err = new Error('required dependency "playwright" is not installed');
  err.dependency = "playwright";
  err.code = "ERR_MODULE_NOT_FOUND";
  err.install = "npm i -D playwright pixelmatch pngjs && npx playwright install chromium";
  throw err;
}

export async function diff() {
  throw new Error("unreachable — capture already failed");
}
