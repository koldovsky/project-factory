// Bounded, dependency-free LLM helper for Tier-1 automations.
// One capped call to the Anthropic Messages API via global fetch (Node >=18).
// Cheap by default (Haiku) and SAFE BY DEGRADATION: with no API key, or on any
// error, it returns null so the automation still ships its deterministic
// findings without a summary. It never throws.
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function hasApiKey(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Returns the summary string, or null (degraded). Output is hard-capped so a
// runaway prompt can't run up a bill.
export async function summarize(prompt, opts = {}) {
  const env = opts.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = opts.model ?? "claude-haiku-4-5-20251001";
  const maxOutputTokens = Math.min(opts.maxOutputTokens ?? 1024, 2048); // hard ceiling
  const timeoutMs = (opts.timeoutSec ?? 60) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: String(prompt).slice(0, 24000) }], // cap input too
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null; // network/abort/parse — degrade, never throw
  } finally {
    clearTimeout(timer);
  }
}
