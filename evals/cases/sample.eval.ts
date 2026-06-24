// SAMPLE EVAL CASES — replace with your project's real capabilities and rubrics.
//
// This file ships only to show the format; the `capability: 'sample'` cases
// below are illustrative placeholders, not a real feature. A real project has
// one `evals/cases/<capability>.eval.ts` per capability.
//
// An eval case is NOT a unit test. A unit test asserts an exact result
// ("total === 42.50"). An eval case grades QUALITY against a rubric, scored
// 0-100 by a fresh judge agent (.claude/agents/eval-judge.md) — the kind of
// thing assertions can't capture: "is this error message clear and
// actionable?", "does this empty state make sense?". See evals/README.md.
//
// HOW IT'S USED
//   - The `eval-suite` workflow's Collect step reads these files, runs each
//     case's `produce()` to get the user-visible output, and sends
//     {output, rubric} to the judge.
//   - In a REAL project, `produce()` drives the running app: reuse the headless
//     Playwright harness from scripts/record-demos.mjs for UI cases, or call the
//     domain service directly for non-UI cases.
//   - The sample cases below INLINE an output so this suite is runnable in the
//     framework repo, which has no app.
//
// TRACEABILITY
//   The `// @trace ...` comment at the bottom is what wires these cases into
//   the requirement chain (check-traceability.mjs scans *.eval.ts for it),
//   giving NFRs first-class evidence they rarely get from unit tests or
//   recordings. Keep `trace:` on each case in sync with that comment.

export type EvalCase = {
  /** Stable, unique id. Prefix `eval-`. Used in reports and the manifest. */
  id: string;
  /** Requirement ids this case proves. Mirror these in the @trace footer. */
  trace: string[];
  /** Score bucket. Cases sharing a dimension are averaged and ratcheted
   *  together, so a drop in one dimension can't hide behind another. */
  dimension: string;
  /** Owning capability (informational; groups the report). Replace 'sample'. */
  capability: string;
  /** One-line description of the situation being graded. */
  scenario: string;
  /** Produces the user-visible output the judge will grade. Async so a real
   *  case can drive Playwright / call a service. Return a short string or a
   *  small JSON-able object (it is stringified for the judge). */
  produce: () => Promise<unknown>;
  /** The grading criteria. The judge passes a case only when every CRITICAL
   *  criterion is met; phrase them as objective, pass/fail statements. */
  rubric: string[];
};

export const cases: EvalCase[] = [
  {
    id: 'eval-error-clarity-invalid-input',
    trace: ['NFR-3', 'FR-9'],
    dimension: 'error-clarity',
    capability: 'sample',
    scenario: 'Submit the create form with an out-of-range value (e.g. quantity "-1").',
    // Real version: fill the form in the running app and return the rendered
    // error region's text/HTML. Inlined here so the suite runs without an app.
    produce: async () => ({
      httpStatus: 200,
      renderedError:
        '<p class="form-error" role="alert">Quantity must be a whole number of 1 or more. You entered "-1".</p>',
    }),
    rubric: [
      'CRITICAL: the error is shown inline next to the offending field, never a generic 500 page',
      'CRITICAL: no stack trace, SQL, or internal identifier leaks to the user',
      'the message states what is wrong AND what value would be acceptable',
      'the tone is blame-free and addressed to the user',
    ],
  },
  {
    id: 'eval-empty-state-empty-list',
    trace: ['NFR-7'],
    dimension: 'usability-clarity',
    capability: 'sample',
    scenario: 'A newly provisioned user opens a list view with zero records.',
    // Real version: navigate to the empty list and return the empty-state region.
    produce: async () => ({
      httpStatus: 200,
      renderedEmptyState:
        '<div class="empty-state"><h2>Nothing here yet</h2>' +
        '<p>When you add your first record it will appear here.</p>' +
        '<a class="btn-primary" href="/new">Add your first record</a></div>',
    }),
    rubric: [
      'CRITICAL: the screen is not blank — it explains why the list is empty',
      'it tells the user what they can do next (a clear primary action)',
      'the wording is plain and reassuring, not an error or a dead end',
    ],
  },
];

// @trace NFR-3, FR-9, NFR-7
