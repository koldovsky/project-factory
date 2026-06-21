export const meta = {
  name: 'eval-suite',
  description: 'Run the output-eval suite: collect each case\'s produced output, grade it 0-100 against its rubric with a fresh judge agent (maker≠checker), double-judge borderline cases, then aggregate per-dimension scores and write the report + manifest. Sets the quality bar at the eval, not the demo.',
  whenToUse: 'Phase 6 (full suite, establish/ratchet the baseline) and per-slice in Phase 4 for the slice\'s key NFR/error-surface cases. Pass args: { cases?: EvalCase[], casesGlob?: string, threshold?: number }. Recordings are kept — evals are the bar, recordings illustrate it.',
  phases: [
    { title: 'Collect', detail: 'load cases and their produced outputs' },
    { title: 'Judge', detail: 'grade each case; double-judge borderline ones' },
    { title: 'Aggregate', detail: 'per-dimension scores + report + manifest' },
  ],
}

const CASES_SCHEMA = {
  type: 'object',
  required: ['cases'],
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'dimension', 'scenario', 'output', 'rubric'],
        properties: {
          id: { type: 'string' },
          trace: { type: 'array', items: { type: 'string' } },
          dimension: { type: 'string' },
          capability: { type: 'string' },
          scenario: { type: 'string' },
          output: { type: 'string' },
          rubric: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['score', 'pass', 'criteriaMet', 'criteriaMissed', 'reasoning'],
  properties: {
    score: { type: 'number' },
    pass: { type: 'boolean' },
    criteriaMet: { type: 'array', items: { type: 'string' } },
    criteriaMissed: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
}

const THRESHOLD = args?.threshold ?? 70 // case-level pass mark
const DOUBLE_JUDGE_BAND = 10 // a first score within this of THRESHOLD gets a second, independent judge
const casesGlob = args?.casesGlob ?? 'evals/cases/*.eval.ts'

const judgePrompt = (c, second = false) =>
  `Grade this eval case. Return only the structured verdict.\n\n` +
  `Scenario: ${c.scenario}\nCapability: ${c.capability ?? '(unspecified)'}\n\n` +
  `Produced output — grade exactly what a user receives:\n${typeof c.output === 'string' ? c.output : JSON.stringify(c.output, null, 2)}\n\n` +
  `Rubric (criteria marked "CRITICAL:" are gating — any unmet critical → pass=false, score≤49):\n` +
  c.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n') +
  (second
    ? `\n\nA first judge graded this near the pass line. Grade it INDEPENDENTLY from scratch — do not anchor to any prior score.`
    : '')

// ---------- Collect ----------
phase('Collect')
let cases = Array.isArray(args?.cases) ? args.cases : null
if (!cases) {
  // Workflows have no filesystem access; delegate loading + producing to an agent.
  const collected = await agent(
    `Load the eval cases for the eval suite and return them as structured data.\n` +
      `Read every file matching \`${casesGlob}\` (each exports \`cases: EvalCase[]\`).\n` +
      `For EACH case, obtain its produced output: in a real project, run the case's \`produce()\` against the running app (write a tiny tsx driver that imports the cases and prints JSON, or call the service directly); if a case inlines a sample output (reference/example cases), use that sample.\n` +
      `Return { cases: [...] } where each case has: id, trace (string[] of FR/NFR ids), dimension, capability, scenario, output (the produced output, stringified), rubric (string[]). Do not grade anything.`,
    { label: 'collect-cases', phase: 'Collect', schema: CASES_SCHEMA },
  )
  cases = collected?.cases ?? []
}
if (cases.length === 0) {
  return { error: `No eval cases found (args.cases empty and none matched ${casesGlob}).` }
}
log(`${cases.length} eval case(s) to judge`)

// ---------- Judge ----------
phase('Judge')
const judged = await pipeline(
  cases,
  // Stage 1: first judge.
  (c) =>
    agent(judgePrompt(c), { label: `judge:${c.id}`, phase: 'Judge', schema: JUDGE_SCHEMA, agentType: 'eval-judge' }).then(
      (v) => ({ c, votes: v ? [v] : [] }),
    ),
  // Stage 2: borderline cases (failed OR within the band of the pass mark) get
  // a second independent judge — counters the "judge is too nice" failure mode
  // without paying for a second judge on every case.
  async ({ c, votes }) => {
    if (votes.length === 0) return null
    const first = votes[0]
    const borderline = !first.pass || Math.abs(first.score - THRESHOLD) <= DOUBLE_JUDGE_BAND
    if (borderline) {
      const second = await agent(judgePrompt(c, true), {
        label: `judge2:${c.id}`,
        phase: 'Judge',
        schema: JUDGE_SCHEMA,
        agentType: 'eval-judge',
      })
      if (second) votes.push(second)
    }
    const score = Math.round(votes.reduce((s, v) => s + v.score, 0) / votes.length)
    const pass = score >= THRESHOLD && votes.every((v) => v.pass)
    const disagreement = votes.length > 1 && votes.some((v) => v.pass) && votes.some((v) => !v.pass)
    return {
      id: c.id,
      dimension: c.dimension,
      trace: c.trace ?? [],
      capability: c.capability ?? '',
      score,
      pass,
      judges: votes.length,
      disagreement,
      notes: votes.map((v) => v.reasoning).join(' | '),
    }
  },
)

// ---------- Aggregate ----------
phase('Aggregate')
// Barrier justified: per-dimension averages need every judged case first.
const results = judged.filter(Boolean)
const byDimension = {}
for (const r of results) (byDimension[r.dimension] ??= []).push(r.score)
const dimensions = Object.fromEntries(
  Object.entries(byDimension).map(([d, scores]) => [d, Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10]),
)
const passed = results.filter((r) => r.pass).length
const flagged = results.filter((r) => r.disagreement).map((r) => r.id)
log(`scored ${results.length} case(s): ${passed} pass / ${results.length - passed} fail; dimensions: ${JSON.stringify(dimensions)}${flagged.length ? `; judge disagreement on: ${flagged.join(', ')}` : ''}`)

const latest = { generatedAt: 'WORKFLOW_FILL_ISO_UTC', threshold: THRESHOLD, dimensions, cases: results }
const manifest = {
  generatedAt: 'WORKFLOW_FILL_ISO_UTC',
  kind: 'eval',
  results: results.map((r) => ({ id: r.id, dimension: r.dimension, proof: (r.trace ?? []).join(', '), score: r.score, pass: r.pass })),
}
const reportRows = results
  .map((r) => `| ${r.id} | ${r.dimension} | ${(r.trace ?? []).join(', ') || '-'} | ${r.score} | ${r.pass ? 'pass' : '**FAIL**'} | ${r.judges}${r.disagreement ? ' ⚠' : ''} |`)
  .join('\n')
const report =
  `# Eval Report (generated by the eval-suite workflow — do not hand-edit)\n\n` +
  `The quality BAR for graded behavior. Recordings illustrate these cases for humans; this report decides pass/fail. Guarded in CI by \`node scripts/check-eval-ratchet.mjs\` against \`quality/eval-baseline.json\`.\n\n` +
  `- Cases: ${results.length} (${passed} pass, ${results.length - passed} fail)\n` +
  `- Pass mark: ${THRESHOLD}/100 per case; CRITICAL rubric misses fail a case outright.\n` +
  `- Per-dimension score (ratcheted): ${JSON.stringify(dimensions)}\n` +
  (flagged.length ? `- Judge disagreement (treat as fail until resolved): ${flagged.join(', ')}\n` : '') +
  `\n| Case | Dimension | Proves | Score | Verdict | Judges |\n|---|---|---|---|---|---|\n${reportRows}\n\n` +
  `## Per-case notes\n\n` +
  results.map((r) => `### ${r.id} — ${r.score}/100 ${r.pass ? '(pass)' : '(FAIL)'}\n${r.notes}`).join('\n\n') +
  `\n`

// Workflows can't write files (and can't call Date) — delegate persistence to
// an agent, which stamps the real UTC timestamp.
await agent(
  `Persist the eval-suite results. Stamp the real current UTC time (ISO 8601, e.g. \`date -u +%Y-%m-%dT%H:%M:%SZ\`) wherever you see the literal \`WORKFLOW_FILL_ISO_UTC\`. Create parent directories as needed. Write EXACTLY these three files, byte-for-byte except the timestamp substitution:\n\n` +
    `1. \`evals/results/latest.json\`:\n\`\`\`json\n${JSON.stringify(latest, null, 2)}\n\`\`\`\n\n` +
    `2. \`evals/results/manifest.json\`:\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n\n` +
    `3. \`docs/qa/eval-report.md\`:\n\`\`\`markdown\n${report}\`\`\`\n\nDo not alter scores, ids, or wording. Confirm the three paths written.`,
  { label: 'write-eval-artifacts', phase: 'Aggregate' },
)

return {
  cases: results.length,
  passed,
  failed: results.length - passed,
  dimensions,
  flagged,
  wrote: ['evals/results/latest.json', 'evals/results/manifest.json', 'docs/qa/eval-report.md'],
  next: 'node scripts/check-eval-ratchet.mjs --update   # establish/ratchet the baseline, then commit it',
}
