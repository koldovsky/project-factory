# Lesson: block-conquest-doctrine (v1)

**A per-block definition-of-done beats page-average iteration.**

## What happened (grounded, abstract)

In the multi-layer visual-parity campaign
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md` and its follow-on
parity work) the acceptance signal started as a single full-page pixel scalar.
That scalar (desktop ~0.9449 / mobile ~0.9052) hid *where* the debt was and
rewarded average-chasing: a run could nudge the mean up while individual
sections stayed broken. Iterating on the page average never converged — fixing
one block while regressing another left the scalar roughly flat.

The turn came from **demoting the full-page scalar to telemetry** and making
acceptance **per block**: each block had to reach its own definition-of-done
before the page could claim done. A high page average with one un-conquered
block is not done — it is debt laundered by a mean.

## The rule

Iterate **block by block to a per-block definition-of-done**, not page-average:

- **Per-block DoD** — a block is done only when it is, independently:
  `unpaired = 0` (every element paired with the reference),
  `geometry = 0` (no box/position break beyond tolerance),
  `paint = 0` (no computed-style/paint divergence),
  `asset = 0` (no missing/other-source asset), **and** `pixel >= floor`.
- **The page is done only when every block is done.** The page-average pixel
  score is *telemetry* (trend it), never the acceptance gate.
- **Overlay / onion-skin feedback** — drive each block down with a localized
  signal: a difference-blend overlay and a 50% onion-skin composite of the
  block on both sites, reviewed by eye / vision. The residual is localized to
  one block and taken to zero before conquering the next; this is what makes
  block-by-block convergence tractable where average-chasing oscillates.

## Install

Upsert `payload/agents-block.md` between its BEGIN/END markers into the target
project's AGENTS.md. Prove the pattern with `run-fixtures.mjs` (red: the page
average passes while the `hero` block is not done on unpaired/geometry/asset;
green: every block reaches DoD and both verdicts agree).
