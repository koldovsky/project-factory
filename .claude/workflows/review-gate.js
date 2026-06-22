export const meta = {
  name: 'review-gate',
  description: 'Multi-dimensional adversarial review of a diff or capability: correctness, security, and spec compliance, with every finding adversarially verified before it is reported.',
  whenToUse: 'Run after each capability slice is implemented (Phase 4e) and once globally before release (Phase 7). Pass args: { scope, baseRef, headRef?, focus? }.',
  phases: [
    { title: 'Find', detail: 'parallel reviewers per dimension' },
    { title: 'Verify', detail: 'adversarial verification of each finding' },
    { title: 'Report', detail: 'confirmed findings summary' },
    { title: 'Persist', detail: 'write per-slice review-findings.json (slice reviews only)' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'severity', 'evidence', 'suggestion'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { enum: ['critical', 'major', 'minor'] },
          evidence: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    severityAdjustment: { enum: ['keep', 'upgrade', 'downgrade'] },
  },
}

const scope = args?.scope ?? 'working tree'
const baseRef = args?.baseRef
const headRef = args?.headRef ?? 'HEAD'
const focus = args?.focus ?? ''
const diffInstruction = baseRef
  ? `Review the changes in \`git diff ${baseRef}..${headRef}\` (run that command yourself; also read surrounding context of changed files).`
  : 'Review the entire current codebase (use AGENTS.md and openspec/ to scope what matters).'

const DIMENSIONS = [
  {
    key: 'correctness',
    agentType: 'code-reviewer',
    prompt: `${diffInstruction}\nScope: ${scope}. ${focus}\nReview for correctness, error handling (any user input path that can throw raw -> 500, silent external-call failures, stale uncontrolled form state), framework-version correctness, data integrity, and maintainability. Return structured findings only.`,
  },
  {
    key: 'security',
    agentType: 'security-reviewer',
    prompt: `${diffInstruction}\nScope: ${scope}. ${focus}\nFull security checklist: authz matrix (server-side enforcement, IDOR on id-fetched routes, tenant scoping), auth/session handling, injection (SQL/HTML/CSV/path), secrets hygiene, dependency audit, abuse resistance (mass assignment, rate limits). Return structured findings only.`,
  },
  {
    key: 'spec-compliance',
    agentType: 'spec-compliance-auditor',
    prompt: `${diffInstruction}\nScope: ${scope}. ${focus}\nAudit the implementation against its OpenSpec requirements and scenarios: missing/partial/contradicted scenarios, undocumented scope drift, ticked tasks without artifacts, FR/NFR coverage. Return structured findings only.`,
  },
  {
    // Eyes-on-pixels lens — the code audit is blind to rendering (a control that
    // renders but is inert, AA-borderline text). Uses the default agent (Read
    // can open images). No-ops when there's no UI change / no screenshots.
    key: 'visual',
    prompt: `${diffInstruction}\nScope: ${scope}. ${focus}\nVISUAL lens (UI only): if this change touches UI AND rendered screenshots exist under docs/qa/ (e.g. demo-recordings/*.png, vision stills), READ those images and report defects a code review cannot see — inert-looking controls, poor color contrast / unreadable text, broken or overlapping layout, content that did not render, wrong-moment frames. Cite the screenshot path as \`file\`. If there is no UI change or no screenshots, return an empty findings list. Return structured findings only.`,
  },
]

phase('Find')
const found = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA, agentType: d.agentType })
      .then((r) => (r?.findings ?? []).map((f) => ({ ...f, dimension: d.key }))),
  ),
)

// Barrier justified: dedup needs the full cross-dimension result set.
const seen = new Set()
const deduped = []
for (const f of found.filter(Boolean).flat()) {
  const key = `${f.file}:${f.line ?? 0}:${f.title.toLowerCase().slice(0, 60)}`
  if (!seen.has(key)) {
    seen.add(key)
    deduped.push(f)
  }
}
log(`${deduped.length} unique findings across ${DIMENSIONS.length} dimensions`)

phase('Verify')
const verified = await parallel(
  deduped.map((f) => () =>
    parallel(
      ['correctness — is the claimed mechanism actually wrong in this code?', 'exploitability/reproducibility — can the claimed problem actually occur for a real user or attacker?'].map(
        (lens) => () =>
          agent(
            `Adversarially verify this review finding through the lens of ${lens}\n\nFinding: ${JSON.stringify(f)}\n\nRead the actual code at the cited location and its callers. Try hard to REFUTE the finding (wrong file, guarded elsewhere, unreachable path, framework already handles it). Default to refuted=true if you cannot positively confirm the mechanism.`,
            { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA },
          ),
      ),
    ).then((votes) => {
      const valid = votes.filter(Boolean)
      const refutes = valid.filter((v) => v.refuted).length
      return { ...f, verdict: refutes >= 2 ? 'rejected' : refutes === 1 ? 'contested' : 'confirmed', verifierNotes: valid.map((v) => v.reasoning) }
    }),
  ),
)

phase('Report')
const confirmed = verified.filter(Boolean).filter((f) => f.verdict === 'confirmed')
const contested = verified.filter(Boolean).filter((f) => f.verdict === 'contested')
const rejected = verified.filter(Boolean).filter((f) => f.verdict === 'rejected')
log(`confirmed: ${confirmed.length}, contested: ${contested.length}, rejected: ${rejected.length}`)

// Persist per-slice review evidence so check-trajectory can PROVE review ran
// before archive (workflows can't touch fs — a writer agent persists it, same
// pattern as eval-suite). Only for a slice review (scope/args.change names a
// change folder); skipped for global / working-tree reviews.
const change = args?.change ?? (typeof scope === 'string' && scope.startsWith('add-') ? scope : null)
if (change) {
  phase('Persist')
  const dims = {}
  for (const d of DIMENSIONS) dims[d.key] = { confirmed: 0, contested: 0, rejected: 0 }
  for (const f of verified.filter(Boolean)) if (dims[f.dimension]) dims[f.dimension][f.verdict] += 1
  const evidence = {
    generatedBy: 'review-gate',
    scope,
    change,
    baseRef: baseRef ?? null,
    headRef,
    dimensions: dims,
    confirmedTitles: confirmed.map((f) => f.title),
    clean: confirmed.length === 0,
    generatedAt: 'WRITER_FILL_ISO_UTC',
  }
  await agent(
    `Persist review evidence. Stamp the real current UTC time (ISO 8601, e.g. \`date -u +%Y-%m-%dT%H:%M:%SZ\`) where you see \`WRITER_FILL_ISO_UTC\`. Create parent dirs. Write EXACTLY this to \`openspec/changes/${change}/review-findings.json\` (byte-for-byte except the timestamp substitution):\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n\nThis is committed as the slice's review evidence (check-trajectory requires \`clean:true\` before archive). Confirm the path written.`,
    { label: `persist:${change}`, phase: 'Persist' },
  )
}

return {
  scope,
  summary: `Review gate for ${scope}: ${confirmed.length} confirmed, ${contested.length} contested (treat as confirmed unless trivially wrong), ${rejected.length} rejected.`,
  confirmed,
  contested,
  rejected,
  reviewEvidence: change ? `openspec/changes/${change}/review-findings.json` : null,
}
