<!-- BEGIN-LESSON-sampling-blindness -->
### Lesson: verified samples are never continuum coverage (sampling-blindness, v1)

- Any check that samples a CONTINUOUS space (viewport width, the element set,
  a single measurement channel) must **declare its sampling dimension** and the
  sample points — and must never report `coverage: continuum` / "100%" / "all
  widths" from a discrete sample set. Coverage from N samples is `sampled`.
- Every sampled check must carry a **stricter-instrument escalation path**: the
  finer instrument that runs before a definition-of-done is claimed or when any
  sample lands near the floor (5-width matrix → fine-step continuum pixel sweep;
  geometry-only channel → pixel channel over the same sweep; fixed element
  matrix → full computed-style diff).
- Field evidence (abstractly, the multi-layer parity campaign): the SAME
  blindness recurred three times — the element matrix, the width matrix, and a
  geometry-only sweep that read 0 divergence bands while 100+ below-floor pixel
  residuals sat between its samples
  (2026-07-02-pixel-perfect-forensics.md + follow-on parity work).
<!-- END-LESSON-sampling-blindness -->
