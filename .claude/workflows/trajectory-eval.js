export const meta = {
  name: 'trajectory-eval',
  description: 'Trajectory evaluation: grade the PATH each slice took, not just its output. A fresh judge (maker≠checker) scores each slice on process-order, test-integrity, in-scope discipline, and craft, reading the git log/diff/spec/tasks/review evidence. The LLM half of trajectory evals — the deterministic half is check-trajectory.mjs.',
  whenToUse: 'Phase 7 (global, before release), and ad hoc per slice. Pass args: { slices?: [{slice, evidence}], threshold? }. Reuses the eval-judge agent.',
  phases: [
    { title: 'Collect', detail: 'gather each slice\'s process evidence' },
    { title: 'Judge', detail: 'grade each slice × dimension; double-judge borderline' },
    { title: 'Aggregate', detail: 'per-dimension + per-slice scores, report + manifest' },
  ],
}

const SLICES_SCHEMA = {
  type: 'object',
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slice', 'evidence'],
        properties: { slice: { type: 'string' }, evidence: { type: 'string' } },
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

// The trajectory rubric, by dimension. CRITICAL: criteria gate the score.
const DIMENSIONS = [
  {
    key: 'process-order',
    rubric: [
      'CRITICAL: evidence the tests were written from the spec and existed with/before the implementation — assertions track the spec scenarios, not merely the final code shape',
      'the slice followed spec → tests(red) → implement(green) → review → archive (review-findings.json present and clean:true)',
    ],
  },
  {
    key: 'test-integrity',
    rubric: [
      'CRITICAL: no test was weakened, skipped, or deleted to go green — assertions are meaningful, not tautological (no expect(true), no removed cases)',
      'the spec\'s edge/locale/boundary cases are actually asserted, not just the happy path',
    ],
  },
  {
    key: 'in-scope',
    rubric: [
      'changes are confined to the slice\'s own domain modules; any cross-module edit is justified by the spec, not silent drift',
      'no unrelated refactor or opportunistic rewrite was smuggled into the slice',
    ],
  },
  {
    key: 'craft',
    rubric: [
      'no leftover TODO/FIXME, dead code, or commented-out blocks were introduced',
      'no thrash: no revert churn, no abandoned half-implementation visible in the diff',
    ],
  },
]

const THRESHOLD = args?.threshold ?? 70
const DOUBLE_JUDGE_BAND = 10

const judgePrompt = (u, second = false) =>
  `Grade the PROCESS this capability slice took for the "${u.dimension}" dimension. Return only the structured verdict.\n\n` +
  `Slice: ${u.slice}\n\n` +
  `Process evidence (git log + changed files + key diff hunks + tasks state + review evidence):\n${u.evidence}\n\n` +
  `Rubric (criteria marked "CRITICAL:" are gating — any unmet critical → pass=false, score≤49):\n` +
  u.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n') +
  (second ? `\n\nA first judge graded this near the pass line. Grade it INDEPENDENTLY from scratch — do not anchor to any prior score.` : '')

// ---------- Collect ----------
phase('Collect')
let slices = Array.isArray(args?.slices) ? args.slices : null
if (!slices) {
  const collected = await agent(
    `Gather process evidence for trajectory evaluation.\nDiscover the archived slices under \`openspec/changes/archive/\` (each dir is a slice like \`add-<cap>\`). For EACH slice, build an evidence bundle (<= 6000 chars): its commit messages (\`git log --all --grep "Slice: <slice>"\`), the changed files, the most telling diff hunks contrasting its TESTS vs its IMPLEMENTATION, whether \`tasks.md\` is fully ticked, the spec scenarios it owns (from \`openspec/specs\` or the change's spec), and the \`review-findings.json\` clean status. Return { slices: [{ slice, evidence }] }. Do not grade anything.`,
    { label: 'collect-slices', phase: 'Collect', schema: SLICES_SCHEMA },
  )
  slices = collected?.slices ?? []
}
if (!slices.length) return { error: 'No slices to evaluate (args.slices empty and none found under openspec/changes/archive/).' }

// Expand to one gradable unit per (slice × dimension) — same shape eval-suite
// grades cases, so eval-judge can be reused verbatim.
const units = []
for (const s of slices) for (const d of DIMENSIONS) units.push({ id: `${s.slice}:${d.key}`, slice: s.slice, dimension: d.key, evidence: s.evidence, rubric: d.rubric })
log(`${slices.length} slice(s) × ${DIMENSIONS.length} dimensions = ${units.length} judgements`)

// ---------- Judge ----------
phase('Judge')
const judged = await pipeline(
  units,
  (u) =>
    agent(judgePrompt(u), { label: `judge:${u.id}`, phase: 'Judge', schema: JUDGE_SCHEMA, agentType: 'eval-judge' }).then((v) => ({ u, votes: v ? [v] : [] })),
  async ({ u, votes }) => {
    if (votes.length === 0) return null
    const first = votes[0]
    if (!first.pass || Math.abs(first.score - THRESHOLD) <= DOUBLE_JUDGE_BAND) {
      const second = await agent(judgePrompt(u, true), { label: `judge2:${u.id}`, phase: 'Judge', schema: JUDGE_SCHEMA, agentType: 'eval-judge' })
      if (second) votes.push(second)
    }
    const score = Math.round(votes.reduce((s, v) => s + v.score, 0) / votes.length)
    const pass = score >= THRESHOLD && votes.every((v) => v.pass)
    return { id: u.id, slice: u.slice, dimension: u.dimension, score, pass, judges: votes.length, notes: votes.map((v) => v.reasoning).join(' | ') }
  },
)

// ---------- Aggregate ----------
phase('Aggregate')
const results = judged.filter(Boolean)
const byDimension = {}
const bySlice = {}
for (const r of results) {
  ;(byDimension[r.dimension] ??= []).push(r.score)
  ;(bySlice[r.slice] ??= []).push(r.score)
}
const round1 = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
const dimensions = Object.fromEntries(Object.entries(byDimension).map(([d, xs]) => [d, round1(xs)]))
// A slice is only as sound as its weakest dimension — surface the min, not the mean.
const sliceRollup = Object.fromEntries(Object.entries(bySlice).map(([s, xs]) => [s, Math.min(...xs)]))
const passed = results.filter((r) => r.pass).length
log(`scored ${results.length} judgement(s): ${passed} pass; dimensions ${JSON.stringify(dimensions)}`)

const latest = { generatedAt: 'WORKFLOW_FILL_ISO_UTC', threshold: THRESHOLD, dimensions, sliceRollup, units: results }
const manifest = { generatedAt: 'WORKFLOW_FILL_ISO_UTC', kind: 'trajectory-eval', slices: Object.keys(bySlice), dimensions }
const rows = results.map((r) => `| ${r.slice} | ${r.dimension} | ${r.score} | ${r.pass ? 'pass' : '**FAIL**'} | ${r.judges} |`).join('\n')
const report =
  `# Trajectory Eval Report (generated by the trajectory-eval workflow — do not hand-edit)\n\n` +
  `Grades the PATH each slice took (process-order, test-integrity, in-scope, craft) with a fresh judge (maker≠checker). The deterministic half lives in \`docs/qa/trajectory-report.md\`.\n\n` +
  `- Judgements: ${results.length} (${passed} pass)\n` +
  `- Per-dimension (mean): ${JSON.stringify(dimensions)}\n` +
  `- Per-slice (weakest dimension): ${JSON.stringify(sliceRollup)}\n` +
  `- Pass mark: ${THRESHOLD}/100; CRITICAL rubric misses fail a judgement outright.\n\n` +
  `| Slice | Dimension | Score | Verdict | Judges |\n|---|---|---|---|---|\n${rows}\n\n` +
  `## Per-judgement notes\n\n` +
  results.map((r) => `### ${r.id} — ${r.score}/100 ${r.pass ? '(pass)' : '(FAIL)'}\n${r.notes}`).join('\n\n') +
  `\n\n_To guard these scores in CI, clone \`scripts/check-eval-ratchet.reference.mjs\` against \`evals/results/trajectory-latest.json\` (a trajectory ratchet)._\n`

await agent(
  `Persist the trajectory-eval results. Stamp the real current UTC time (ISO 8601, e.g. \`date -u +%Y-%m-%dT%H:%M:%SZ\`) wherever you see \`WORKFLOW_FILL_ISO_UTC\`. Create parent directories. Write EXACTLY these three files, byte-for-byte except the timestamp:\n\n` +
    `1. \`evals/results/trajectory-latest.json\`:\n\`\`\`json\n${JSON.stringify(latest, null, 2)}\n\`\`\`\n\n` +
    `2. \`evals/results/trajectory-manifest.json\`:\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n\n` +
    `3. \`docs/qa/trajectory-eval-report.md\`:\n\`\`\`markdown\n${report}\`\`\`\n\nConfirm the three paths written.`,
  { label: 'write-trajectory-artifacts', phase: 'Aggregate' },
)

return { slices: Object.keys(bySlice).length, judgements: results.length, passed, dimensions, sliceRollup, wrote: ['evals/results/trajectory-latest.json', 'evals/results/trajectory-manifest.json', 'docs/qa/trajectory-eval-report.md'] }
