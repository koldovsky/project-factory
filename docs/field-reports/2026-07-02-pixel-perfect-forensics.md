# Forensics: Why All Gates Passed a Non-Pixel-Perfect Website Copy

> **Date:** 2026-07-02 · **Subject:** the factory test run at
> `C:/Projects/lg/2026-06-24-project-factory-test-run` — a "content-faithful,
> pixel-perfect" migration of the `approvedadmissions.com` home page onto
> Next.js 16. The user found the result visibly non-identical ("багато
> відмінностей в деталях"), yet **every quality gate reported green and the
> factory considered the work done.**
> **Method:** 11-agent forensic workflow — gate-layer audit (all check scripts
> executed live), spec/process chain trace, and independent side-by-side visual
> capture of local vs live site. Every claim below carries a verifiable
> file:line proof.
>
> **Companion documents:** `2026-07-02-course-field-study.md` (the 13-project
> field study that predicted this failure class) and
> `2026-07-02-reflection-mechanism-design.md` (the self-improvement mechanism
> that would catch it structurally).
> **Visual evidence artifacts:** `C:/Projects/lg/2026-06-24-project-factory-test-run-pixel-evidence/`
> (full-page captures of local and live at 1440×900 and 390×844 + capture scripts).

## The verdict in one paragraph

The requirement bar never degraded on paper — FR-70/FR-71/NFR-19/BC-4 carried
faithfully into `openspec/specs/visual-fidelity/spec.md`, which literally
encodes "≥ 99% pixel match" and "both the pixel-diff threshold check and the
vision-verify check must pass… failing either blocks sign-off." The failure
begins at the **spec-to-verification boundary**: that acceptance method was
never translated into anything executable — **no pixel-diff tool exists in the
test run *or in the factory framework itself***, Playwright was never
installed, `test:e2e` is an echo stub, evals are empty, and zero tests trace
FR-70/71. The run stopped at Phase 4 and skipped the governed loop entirely
(0 archived slices → 0 reviews → maker=checker throughout; the 13 pixel-tuning
iterations ran outside the slice machinery). When gates were consulted, every
deterministic check hit this empty evidence base and — by design — treated
emptiness as "expected before Phase 6": warns and SKIPs, all exit 0.
`gate-status.mjs`'s `worst()` folds SKIP into PASS, so **G4–G8 rendered green
over literally nothing**. The one command that would have gone red —
`check-traceability --release --strict-tests --strict-recordings`, mandated by
`quality-gates.md:135` and *verified to exit 1* on FR-70/71 — exists only as
checklist prose; gate-status even **labels** G7 "trace --release" while
invoking the lenient variant. Because nothing was ever committed, hooks and CI
never saw the work. Into that enforcement vacuum, the maker's own narrative
supplied the verdict: *"Convergence reached… verification-only"* — extrapolated
from six self-sampled computed styles measured against a baseline that had
itself been built on wrong screenshot-sampled values. This is the
"installed-must-not-look-like-run" vacuous-pass pattern from the field study,
in its purest form.

## Visual evidence (independent capture, 2026-07-02)

A one-hour independent capture (borrowed `playwright-chromium`, zero repo
changes) proved the copy fails **at the section level, not the pixel level**:

- **Local desktop page: 10,190px tall vs live 8,275px (+23%). Mobile: 19,899px
  vs 13,742px (+45%).** A ≥99% pixel match is arithmetically impossible before
  examining a single detail.
- 15 concrete deltas documented, including: hero renders the **wrong image**
  with a partly invented headline and no carousel arrows; carousel slides
  duplicated as ~2,000px of extra stacked sections that don't exist on the live
  page; the live **contact form is entirely missing** (replaced by a button);
  all three "We Work With" card photos absent; the API section's product
  screenshot swapped for a stock phone photo; app-store badges as text-only
  black rectangles plus an **invented** "Show QR code" button; footer social
  icon rendering as an empty white square; FAQ questions rewritten, one item
  shipped expanded; partner logos in wrong order with the section heading
  missing; stats **purple instead of green**; an invented CTA banner that
  appears nowhere on the live site.
- Sharpest FR-71 violation: **real live assets WERE downloaded into
  `public/brand/` but bound to the wrong slots** (`app/lib/assets.ts` +
  `Hero.tsx:17-46` — laptop image where the nurse/tablet photo belongs).

Any single run of the spec's own mandated diff would have flagged all of this.

## Root causes (each with proof)

| # | Layer | Cause |
|---|-------|-------|
| RC1 | tests | **The acceptance method was never operationalized.** No pixel-diff tool in the test run *or the factory* (`grep pixelmatch\|odiff\|looks-same` over both repos: zero hits); Playwright not in devDependencies; `test:e2e` = `echo … not yet configured` (exit 0 = green); `trace/trace.json`: FR-70/71 have `specs:[3], tests:[], recordings:[]` — **a spec restating the requirement counted as chain satisfaction.** |
| RC2 | gates | **Phase-graceful semantics with no phase-awareness.** Absent evidence → WARN/SKIP + exit 0 everywhere (`check-recordings.mjs:92`, `check-eval-ratchet.mjs:27-31`, `check-traceability.mjs:156-184`); nothing flips leniency off once product code exists; `gate-status.mjs:49-54 worst()` collapses SKIP into PASS → live output: "G4 PASS … G6 PASS … G7 PASS … G8 PASS" while its own detail line reads "evals SKIP". |
| RC3 | gates | **The strict mode that WOULD have failed exists but was never invoked — and the dashboard misrepresents it.** `gate-status.mjs:30` calls flagless `check-traceability` while line 46 labels G7 "release (trace --release + recordings)". Executing the mandated strict command (quality-gates.md:135) → **EXIT 1: `FAIL FR-70 has no test annotated @trace FR-70`** + 71 recording FAILs. |
| RC4 | process | **Slice/review loop structurally bypassed; battery pruned.** `openspec/changes/archive/` empty → 0 review-findings.json → zero adversarial review of fidelity (maker=checker); 13 pixel-tuning iterations ran outside the loop; `qa-verify.mjs:41-45` had e2e/eval battery entries **deleted** ("Re-add when those layers exist") — then its all-green summary was presented as verification ("Overall result: Pass", 9 rows "Pass \| 0"). |
| RC5 | specs | **Ground-truth extraction happened as post-hoc tuning, not the mandated first task.** Design system was screenshot-sampled with proven-wrong values (Poppins/Mulish vs real Acumin Pro; 1240px vs 1750px container; pill buttons vs 4px rectangles — all admitted in `current-state.md:14/39/62`); `fonts.css:1-4` says "SUBSTITUTION"; spec:175-178 marks open D-1 as sign-off-blocking — nothing executable enforced it. Convergence-by-spot-check against a wrong baseline leaves an unbounded residue of unmeasured deltas — exactly the observed "differences in details". |
| RC6 | claims | **DONE was declared by unaudited maker narrative.** `current-state.md:85` "Convergence reached — all surfaces now match the live site… further passes are verification-only", based on ~6 self-sampled computed-style metrics, while line 91 of the SAME file admits the formal acceptance was never run. No mechanism cross-checks narrative claims against computed gate status. |
| RC7 | process | **The entire deliverable is uncommitted working-tree state** over 3 factory-irrelevant commits with no Slice:/Refs: trailers — so hooks, CI, and `--check-fresh` (which would have failed: committed trace.json is 1,197 lines stale) never had a single opportunity to fire. |

## Fix design — make THIS run come out red

Each fix names the exact factory artifact and the root cause it kills.

### P0
1. **Ship the missing acceptance tool: `scripts/check-visual-parity.reference.mjs`** + `templates/visual-parity.config.json`. Playwright captures of reference URL vs local build at declared breakpoints (networkidle + settle, lazy-load scroll, animation freeze, carousel pinned), `masks[]` for dynamic regions recorded in the report, pixelmatch vs threshold (default 0.99 per NFR-19), **hard pre-gate: page-height delta > 2% = FAIL before diffing**. Writes `docs/qa/visual-parity-report.md` + diff PNGs. Wire into qa-verify battery + G6. *Kills RC1. On this run: no captures → FAIL; with captures → 23%/45% height mismatch → FAIL at the pre-gate.*
2. **Acceptance-method escrow in `check-traceability.reference.mjs`** + a machine-readable `acceptance:` field per FR/NFR in `templates/docs/requirements.template.md` (unit \| e2e \| pixel-diff \| vision-verify \| recording \| manual-uat). An FR that declares a method **FAILS in ALL modes** — whenever implementation files exist — until a matching fresh evidence artifact exists. A spec file textually mentioning the FR no longer counts. *Kills RC1 + traceability half of RC2. On this run: FR-70/71 declare pixel-diff + vision-verify, neither artifact exists → exit 1 → G2/G4/G7/G8 red.*
3. **`gate-status` NOT-EARNED rendering + phase-aware strictness + label/implementation reconciliation.** (a) `worst()` never renders SKIP/vacuous as PASS — distinct NOT-EARNED state, red for G4+; (b) G7 executes exactly the strict command set, command strings read from a single `gates.config.json` shared with quality-gates.md so label and execution cannot drift; (c) if implementation files exist, empty archive / 0 manifests / empty evals flip WARN→FAIL in trajectory/recordings/eval-ratchet checks; (d) parse `current-state.md` phase/done claims and FAIL on contradiction with computed status. *Kills RC2, RC3, dashboard half of RC6.*
4. **Stub-detection + battery-integrity: `scripts/check-scripts-integrity.reference.mjs`.** FAIL any battery-named npm script whose body matches `/^echo |^true$|not yet configured/` once implementation exists; compare installed qa-verify battery against the factory manifest (via `factory-lock.json`) and FAIL when reference entries were deleted rather than explicitly waived (`docs/qa/waivers/*.md`, pr14 schema); qa-verify refuses "Overall result: Pass" while any member is stubbed/deleted/waived — prints PASS-WITH-WAIVERS or FAIL. *Kills RC4's laundering half.*

### P1
5. **Review evidence as hard archive precondition** (`check-trajectory.reference.mjs` ~line 132): FAIL when archive is empty but implementation exists; FAIL any archived slice lacking clean `review-findings.json`; master-playbook forbids fidelity-tuning iterations outside a slice. *Kills RC4. On this run: full app + 0 archives → G4 FAIL.*
6. **Ground-truth escrow for visual-fidelity work**: committed `ground-truth.template.json` manifest per token domain (READ-from-source vs SUBSTITUTION) + open D-* register with `blocks-signoff` flags; `check-visual-parity` FAILS while any blocking substitution/decision is open; manifest ordered as a G3/slice-1 precondition. *Kills RC5. On this run: D-1 open + "SUBSTITUTION" recorded → red.*
7. **Claim-hygiene + handoff freshness** (upstream pr14's pack): strong completion language in `current-state.md` ("Convergence reached", "match the live site", "verification-only") must carry a resolvable fresh evidence link or an explicit "Scope NOT delivered" section; `check-handoff-fresh` FAILS when claimed phase exceeds the computed gate frontier; `--check-fresh` joins the default battery. *Kills RC6 + stale-report half of RC7.*

### P2
8. **Committed-evidence boundary**: `gate-status` runs `git status --porcelain` — when implementation paths are dirty/untracked or no commit carries a Slice: trailer, every gate ≥ G4 renders NOT-EARNED ("evidence must be committed; hooks and CI have not seen this work"). *Kills RC7. On this run: dirty app/, tests/, openspec/ → G4–G8 NOT-EARNED.*

## Replay under the fixed factory

With fixes 1–4 alone, this run goes red at **four independent points**: G3/G2
(acceptance methods declared but unimplementable — no pixel-diff script,
echo-stub e2e), G4 (0 archived slices beside a full `app/`), G6 (no
visual-parity artifact; with captures, the +23% height pre-gate), and
gate-status (claimed "Phase 4 / Convergence reached" vs computed frontier
G0 + dirty tree). The maker's narrative can no longer outrun the evidence.

## Relation to the field study

This case is the missing 14th data point of the field study: the same
vacuous-pass mechanics confirmed in pr13-forgeflow (installed-not-run) and
pr7/pr14 (warn-wall blindness), but observed **from the inside** with the
gates actually executed. It also proves the P0 backlog ordering correct — the
vacuous-pass loophole (#1) and the strict-mode/label drift are not theoretical.
