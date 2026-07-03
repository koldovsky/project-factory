# Requirements Document

**Pixel Copy Fixture (green)**

*Same acceptance contract as the red fixture — but every declared method has a
real mechanism and a fresh, threshold-passing artifact.*

## 2 Functional Requirements (FR)

### 2.1 Content Fidelity

| ID | Phase | Area | Description |
|---|---|---|---|
| FR-1 | MVP | Content | Home page reproduces the live site's section order and copy (verify: local-verifiable). |
| FR-70 | MVP | Fidelity | Every interactive flow on the home page is covered by an end-to-end test (verify: e2e). |

## 3 Non-Functional Requirements (NFR)

| ID | Category | Description |
|---|---|---|
| NFR-19 | Fidelity | Rendered pages must achieve >= 99% pixel match against the reference site at all declared breakpoints (verify: pixel-diff, vision-verify). |
