export const meta = {
  name: 'spec-pipeline',
  description: 'Fan out baseline OpenSpec capability specs: one spec-writer per capability, each draft critiqued and revised, then a cross-capability coverage check (every MVP FR owned exactly once, no contradictions).',
  whenToUse: 'Phase 2 of the master playbook. Pass args: { capabilities: [{ name, frIds, nfrIds?, notes? }], requirementsPath }.',
  phases: [
    { title: 'Author', detail: 'draft + critique + revise per capability' },
    { title: 'Cross-check', detail: 'coverage and consistency over all specs' },
  ],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['issues', 'acceptable'],
  properties: {
    acceptable: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
}

const COVERAGE_SCHEMA = {
  type: 'object',
  required: ['allCovered', 'gaps', 'duplicates', 'contradictions'],
  properties: {
    allCovered: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' } },
    duplicates: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
  },
}

const requirementsPath = args?.requirementsPath ?? 'docs/requirements.md'
const capabilities = args?.capabilities ?? []
if (capabilities.length === 0) {
  return { error: 'Pass args.capabilities: [{ name, frIds, ... }]' }
}

phase('Author')
const authored = await pipeline(
  capabilities,
  (cap) =>
    agent(
      `Author the baseline OpenSpec spec for capability "${cap.name}" at openspec/specs/${cap.name}/spec.md.\nRequirements source: ${requirementsPath}. This capability owns: ${JSON.stringify(cap.frIds)}${cap.nfrIds ? `; travelling NFRs: ${JSON.stringify(cap.nfrIds)}` : ''}. ${cap.notes ?? ''}\nUse strict OpenSpec format (### Requirement / #### Scenario with GIVEN/WHEN/THEN). Cover every owned FR, include error-path scenarios and explicit exclusions. Write the file, then return the list of requirement names you authored.`,
      { label: `draft:${cap.name}`, phase: 'Author', agentType: 'spec-writer' },
    ),
  (draftResult, cap) =>
    agent(
      `Critique the spec at openspec/specs/${cap.name}/spec.md against ${requirementsPath} (owned FRs: ${JSON.stringify(cap.frIds)}).\nCheck: every owned FR covered; every scenario objectively pass/fail decidable; error paths present (invalid input, unauthorized, oversized/locale-formatted values); explicit exclusions stated; no scope invented beyond the FRs. Return acceptable=true only if you found nothing material.`,
      { label: `critique:${cap.name}`, phase: 'Author', schema: CRITIQUE_SCHEMA },
    ),
  async (critique, cap) => {
    if (critique && !critique.acceptable && critique.issues.length > 0) {
      await agent(
        `Revise openspec/specs/${cap.name}/spec.md to resolve these critique issues, then run \`npx openspec validate --all --strict\` and fix any validation errors:\n${critique.issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}`,
        { label: `revise:${cap.name}`, phase: 'Author', agentType: 'spec-writer' },
      )
      return { capability: cap.name, revised: true, issuesFixed: critique.issues.length }
    }
    return { capability: cap.name, revised: false, issuesFixed: 0 }
  },
)

phase('Cross-check')
// Barrier justified: coverage check needs every spec written first.
const coverage = await agent(
  `Cross-check ALL baseline specs under openspec/specs/ against ${requirementsPath}.\nCapability ownership map: ${JSON.stringify(capabilities.map((c) => ({ name: c.name, frIds: c.frIds })))}.\nVerify: (1) every MVP FR appears in exactly one spec - list gaps and duplicates by FR id; (2) no two specs contradict each other (shared entities, statuses, role names); (3) cross-cutting NFRs are not silently owned by one spec. Read the actual spec files.`,
  { label: 'coverage-check', phase: 'Cross-check', schema: COVERAGE_SCHEMA },
)

log(
  coverage?.allCovered
    ? 'Coverage check passed: all MVP FRs owned exactly once.'
    : `Coverage problems - gaps: ${coverage?.gaps?.length ?? '?'}, duplicates: ${coverage?.duplicates?.length ?? '?'}, contradictions: ${coverage?.contradictions?.length ?? '?'}`,
)

return { authored: authored.filter(Boolean), coverage }
