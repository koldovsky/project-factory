# Spec: visual fidelity

Implements NFR-19 and FR-70.

- NFR-19: both the pixel-diff threshold check (>= 99% pixel match) and the
  vision-verify check must pass against the reference
  https://approvedadmissions.example.com/ — failing either blocks sign-off.
- FR-70: verify: e2e.
