# UAT Bug: stats section renders purple, not green

- Found during UAT on 2026-07-02
- Requirement: FR-70 (visual fidelity of the stats section)
- Gate context: G6 had rendered PASS for this slice; the sign-off battery
  reported green while the section color is visibly wrong on the live copy.

A UAT bug filed against a gate that passed (G6) is an auto-correction event:
the gate let a defect through.
