# Lesson: sampling-blindness (v1)

**Verified samples must never be presented as continuum coverage.**

## What happened (grounded, abstract)

The multi-layer visual-parity campaign
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md` and its follow-on
parity work) hit the *same* blindness three separate times: a check sampled a
few points of a continuous space, every sampled point passed, and the result
was read as if the whole space had been covered.

1. **Element matrix.** Per-element computed-style parity was audited against a
   fixed `element-matrix.json` — a curated set of elements. Elements outside
   the matrix (and attributes added by later reworks) were simply unaudited;
   "the matrix is green" was mistaken for "every element matches".
2. **Width matrix.** L1–L4 were verified to hold at five calibrated widths
   (320 / 390 / 768 / 1440 / 1920). A between-sample regression at ~1200px
   sat undetected — the five-width matrix could not see it.
3. **Geometry-only sweep.** A continuum sweep's *geometry* channel read **0
   divergence bands** across every block, and was read as "swept clean". The
   same-tier pixel distribution the geometry channel is structurally blind to
   carried **100+ below-floor residuals** — only surfaced once a pixel channel
   was added to the same sweep.

Each time, a discrete instrument's clean result was narrated as continuum
coverage. That is the defect: not that sampling is wrong (it is necessary),
but that a sample was allowed to *speak for the whole population* with no
declared sampling dimension and no path to a stricter instrument.

## The rule

Every sampled check must **state its sampling dimension and carry a
stricter-instrument escalation path**:

- **Declare the sampling dimension** — what continuous space is being sampled
  (viewport width, element set, geometry vs paint channel) and at what points.
- **Never advertise continuum / "100%" / "all widths" coverage** from a
  discrete sample set. Coverage is `sampled`, not `continuum`.
- **Declare the escalation** — the stricter instrument that runs before a
  definition-of-done is claimed or when any sample lands near the floor (e.g.
  a 5-width matrix escalates to a fine-step continuum pixel sweep; a
  geometry-only channel escalates to a pixel channel over the same sweep).

## Install

Upsert `payload/agents-block.md` between its BEGIN/END markers into the target
project's AGENTS.md. Prove the pattern with `run-fixtures.mjs` (red: a report
overclaiming continuum from five samples, blind to a 1200px divergence; green:
a report that declares its sampling dimension + escalation and holds across the
continuum).
