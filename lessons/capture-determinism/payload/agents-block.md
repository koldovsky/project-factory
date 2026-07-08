<!-- BEGIN-LESSON-capture-determinism -->
### Lesson: neutralize the capture before trusting it (capture-determinism, v1)

- A parity capture is trustworthy only after every known non-determinism source
  is neutralized. A same-input re-capture must be byte-stable; an unstable
  capture is a HARNESS defect (file it), never a product parity finding.
- The gotchas ledger — check each before treating a below-floor sample as real:
  1. **Carousel free-run timers** survive `autoplay.stop` — clear the timers,
     not just the flag, or the slide advances mid-shot.
  2. **Sub-pixel clip origin** ghosts the raster — snap clip origin to integer.
  3. **`captureBeyondViewport`** duplicates `position:fixed` chrome down the
     page — disable it when fixed chrome is present.
  4. **Lazy third-party widgets** come back blank under fast capture — settle /
     render-gate them on BOTH sites first.
  5. **In-context persistence probes** (localStorage/cookies/state) leak between
     captures — clear persistence so each shot is context-independent.
- Field evidence (abstractly): a fresh sweep over-counted by 100+ samples plus
  phantom geometry bands purely because a lazy live widget rendered blank under
  the fast path (2026-07-02-pixel-perfect-forensics.md + follow-on parity work).
<!-- END-LESSON-capture-determinism -->
