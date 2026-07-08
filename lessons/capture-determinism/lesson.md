# Lesson: capture-determinism (v1)

**A parity capture is trustworthy only if it neutralizes every known
non-determinism source first — the gotchas ledger.**

## What happened (grounded, abstract)

In the multi-layer visual-parity campaign
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md` and its follow-on
parity work) a large share of "failures" were **capture artifacts, not product
regressions** — the screenshot pipeline itself was non-deterministic. A fresh
full sweep once over-counted by 100+ below-floor samples plus phantom geometry
bands because the LIVE reference's lazy contact-form widget intermittently came
back **blank** under the fast pixel-capture path, while the local render was
correct. Chasing those ghosts wastes the whole loop; the fix is a standing
ledger of capture hazards, each neutralized before a capture is trusted.

## The gotchas ledger (neutralize each before trusting a capture)

1. **Carousel free-run timers surviving `autoplay.stop`.** Stopping autoplay is
   not enough — the free-running interval/RAF timers keep advancing the slide
   mid-capture. Clear the timers, not just the autoplay flag.
2. **Sub-pixel clip-origin ghosts.** A non-integer clip origin resamples the
   raster and leaves 1px anti-aliased ghosts along edges. Snap the clip origin
   to an integer.
3. **`captureBeyondViewport` fixed-chrome bleed.** Beyond-viewport capture
   duplicates `position: fixed` chrome (sticky header/nav) down the full-page
   image. Disable `captureBeyondViewport` when fixed chrome is present.
4. **Lazy third-party widgets.** Late-rendering embeds (forms, maps, marquees)
   return blank under a fast capture path. Settle / render-gate them before
   shooting, on BOTH the reference and the candidate.
5. **In-context persistence probes.** `localStorage` / cookies / app state left
   from a prior capture perturb the next one. Clear persistence between
   captures so each shot is context-independent.

## The rule

Before a below-floor sample is treated as a product defect, the capture must be
proven deterministic against this ledger. A same-input re-capture must be
byte-stable; an unstable capture is a harness defect (file it), never a parity
finding.

## Install

Upsert `payload/agents-block.md` between its BEGIN/END markers into the target
project's AGENTS.md. Prove the pattern with `run-fixtures.mjs` (red: a capture
that stopped autoplay but left free-run timers, a sub-pixel clip origin,
`captureBeyondViewport` over fixed chrome, an unsettled lazy widget and an
uncleared persistence probe; green: all five neutralized).
