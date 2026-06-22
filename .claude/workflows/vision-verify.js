export const meta = {
  name: 'vision-verify',
  description: 'Eyes-on-pixels validation: a fresh judge LOOKS AT each recorded settled still and decides whether it visibly demonstrates the requirement and is legible {met, readable}. Catches what code review, DOM assertions, and even axe miss (dead controls, poor contrast, wrong-moment frames). Pairs with record-demos + check-recordings; on any miss, fix -> re-record -> re-verify until met.',
  whenToUse: 'Phase 6 (after recording) and Phase 8 (bug-fix proofs), for any UI capability. Pass args: { clips?: [{id, proof, screenshot, requirement}] } or it reads docs/qa/**/manifest.json.',
  phases: [
    { title: 'Collect', detail: 'gather clip stills + the requirement each proves' },
    { title: 'See', detail: 'vision-judge looks at each still (maker≠checker)' },
    { title: 'Report', detail: 'verdicts + which clips must be fixed and re-recorded' },
  ],
}

const CLIPS_SCHEMA = {
  type: 'object',
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'screenshot', 'requirement'],
        properties: { id: { type: 'string' }, proof: { type: 'string' }, screenshot: { type: 'string' }, requirement: { type: 'string' } },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['met', 'readable', 'notes'],
  properties: { met: { type: 'boolean' }, readable: { type: 'boolean' }, notes: { type: 'string' } },
}

// ---------- Collect ----------
phase('Collect')
let clips = Array.isArray(args?.clips) ? args.clips : null
if (!clips) {
  const collected = await agent(
    `Collect the recorded clips to vision-verify. Read every \`docs/qa/**/manifest.json\`; for each result return { id, proof, screenshot (the .png path), requirement (what FR/behavior the clip proves — derive from proof + the clip's explainer .md or title) }. Return { clips: [...] }.`,
    { label: 'collect-clips', phase: 'Collect', schema: CLIPS_SCHEMA },
  )
  clips = collected?.clips ?? []
}
if (clips.length === 0) return { error: 'No clips to verify (no args.clips and no manifest.json found).' }
log(`${clips.length} clip still(s) to look at`)

// ---------- See ----------
phase('See')
const judged = await parallel(
  clips.map((c) => () =>
    agent(
      `Look at this rendered UI screenshot and judge whether it visibly proves the requirement and is legible.\n\nScreenshot file: ${c.screenshot}\nRequirement it must prove: ${c.requirement}${c.proof ? `\nFR ids: ${c.proof}` : ''}\n\nRead the image (actually look at the pixels) and return the verdict.`,
      { label: `see:${c.id}`, phase: 'See', schema: VERDICT_SCHEMA, agentType: 'vision-judge' },
    ).then((v) => ({ id: c.id, proof: c.proof ?? '', screenshot: c.screenshot, ...(v ?? { met: false, readable: false, notes: 'no verdict' }) })),
  ),
)

// ---------- Report ----------
phase('Report')
const results = judged.filter(Boolean)
const failed = results.filter((r) => !(r.met && r.readable))
log(`${results.length - failed.length}/${results.length} clips met + readable${failed.length ? `; FIX & RE-RECORD: ${failed.map((f) => f.id).join(', ')}` : ''}`)

await agent(
  `Persist the vision verdicts. Stamp the real current UTC time where you see \`WORKFLOW_FILL_ISO_UTC\`. Write \`docs/qa/vision-report.md\` with a table (clip | proves | met | readable | notes) and a Failures section. Also update each clip's entry in its \`docs/qa/**/manifest.json\` to add \`"vision": { "met": <bool>, "readable": <bool>, "notes": "..." }\` (so check-recordings can gate on it). Verdicts:\n\n\`\`\`json\n${JSON.stringify({ generatedAt: 'WORKFLOW_FILL_ISO_UTC', results }, null, 2)}\n\`\`\``,
  { label: 'write-vision', phase: 'Report' },
)

return {
  clips: results.length,
  passed: results.length - failed.length,
  failed: failed.map((f) => ({ id: f.id, notes: f.notes })),
  verdict: failed.length === 0 ? 'all clips visibly prove their requirement and are readable' : 'some clips do NOT — fix the UI, re-record, and re-run vision-verify until met',
}
