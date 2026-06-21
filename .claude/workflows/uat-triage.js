export const meta = {
  name: 'uat-triage',
  description: 'Triage a UAT bug report: one analyst per reported bug maps it to requirements and code with a verdict, low-confidence verdicts get a second opinion, then a synthesis pass clusters confirmed defects by root-cause mechanism so fixes target the class, not the symptom.',
  whenToUse: 'Phase 8 of the master playbook, whenever a QA/UAT bug report arrives. Pass args: { bugs: [{ id, area?, text, steps? }] }.',
  phases: [
    { title: 'Triage', detail: 'one bug-triage-analyst per reported bug' },
    { title: 'Second opinion', detail: 'verify low-confidence verdicts' },
    { title: 'Cluster', detail: 'group confirmed defects by root cause' },
  ],
}

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['bugId', 'verdict', 'rootCause', 'requirementRefs', 'confidence'],
  properties: {
    bugId: { type: 'string' },
    verdict: { enum: ['confirmed-defect', 'works-as-specified', 'environment', 'cannot-reproduce'] },
    requirementRefs: { type: 'array', items: { type: 'string' } },
    rootCause: { type: 'string' },
    mechanism: { type: 'string' },
    classMembers: { type: 'array', items: { type: 'string' } },
    fixDirection: { type: 'string' },
    regressionTestIdea: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
  },
}

const CLUSTER_SCHEMA = {
  type: 'object',
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mechanism', 'bugIds', 'fixPlan'],
        properties: {
          mechanism: { type: 'string' },
          bugIds: { type: 'array', items: { type: 'string' } },
          fixPlan: { type: 'string' },
          additionalLatentLocations: { type: 'array', items: { type: 'string' } },
          regressionTests: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const bugs = args?.bugs ?? []
if (bugs.length === 0) {
  return { error: 'Pass args.bugs: [{ id, text, steps? }]' }
}

const verdicts = await pipeline(
  bugs,
  (bug) =>
    agent(
      `Triage this reported UAT bug against docs/requirements.md, openspec/specs/, and the code.\n\nBug ${bug.id}${bug.area ? ` (area: ${bug.area})` : ''}: ${bug.text}\n${bug.steps ? `Steps to reproduce: ${bug.steps}` : ''}\n\nMap it to governing requirements (quote them), trace the exact code path, and return your structured verdict. Be mechanism-specific about root cause and list every other location sharing the same latent mechanism (the fix must cover the class).`,
      { label: `triage:${bug.id}`, phase: 'Triage', schema: TRIAGE_SCHEMA, agentType: 'bug-triage-analyst' },
    ),
  async (verdict, bug) => {
    if (!verdict) return null
    if (verdict.confidence === 'high') return verdict
    const second = await agent(
      `Independently re-triage UAT bug ${bug.id}: ${bug.text}\n${bug.steps ? `Steps: ${bug.steps}` : ''}\nA first analyst concluded: ${JSON.stringify(verdict)}\nDo NOT trust that conclusion - re-derive from requirements and code yourself, then return your own structured verdict.`,
      { label: `second:${bug.id}`, phase: 'Second opinion', schema: TRIAGE_SCHEMA, agentType: 'bug-triage-analyst' },
    )
    if (second && second.verdict === verdict.verdict) {
      return { ...verdict, confidence: 'high', secondOpinion: 'agrees' }
    }
    return { ...verdict, secondOpinion: second ? `DISAGREES: ${second.verdict} - ${second.rootCause}` : 'unavailable', needsHumanJudgment: true }
  },
)

phase('Cluster')
const valid = verdicts.filter(Boolean)
const confirmed = valid.filter((v) => v.verdict === 'confirmed-defect')
log(`${valid.length} verdicts: ${confirmed.length} confirmed-defect, ${valid.filter((v) => v.verdict === 'works-as-specified').length} works-as-specified, ${valid.filter((v) => v.verdict === 'environment').length} environment, ${valid.filter((v) => v.verdict === 'cannot-reproduce').length} cannot-reproduce`)

// Barrier justified: clustering needs every verdict.
const clusters = confirmed.length
  ? await agent(
      `Cluster these confirmed UAT defects by shared root-cause MECHANISM (not by screen). For each cluster produce one fix plan that resolves the whole class everywhere it occurs - including latent locations no bug was filed against. Defects:\n${JSON.stringify(confirmed, null, 2)}`,
      { label: 'cluster-root-causes', phase: 'Cluster', schema: CLUSTER_SCHEMA },
    )
  : { clusters: [] }

return {
  verdicts: valid,
  clusters: clusters?.clusters ?? [],
  flaggedForHuman: valid.filter((v) => v.needsHumanJudgment),
}
