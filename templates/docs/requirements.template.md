# Requirements Document

**{{PROJECT_NAME}}**

*Prepared for estimation and spec-driven delivery*

## 1 Company Business Overview

{{2-4 paragraphs: who the customer is, how they operate today, the pains,
what the platform must do end-to-end, MVP vs Future Phase boundary.}}

## 2 Functional Requirements (FR)

Requirements are grouped by functional area. 'Phase' indicates MVP or Future.

Every FR and NFR row MUST carry a **Verification** tag — the declared,
executable acceptance method. Closed vocabulary (comma-separate to combine):

| Tag | Meaning |
|---|---|
| `local-verifiable` | a repo script/test proves it deterministically (unit/integration test, pixel-diff script, policy check) |
| `vision-verify` | a fresh agent inspects the settled rendered result |
| `recording` | an asserted demo clip covers the behavior |
| `e2e` | end-to-end browser test |
| `a11y` | axe accessibility gate (light + dark) |
| `eval` | graded rubric eval under `evals/cases/` |
| `deploy-gated` | only provable against the deployed target |

`check-acceptance-methods` enforces the declaration: at **G3 (existence
mode)** every declared tag must resolve to a real, non-stub mechanism in the
repo; from **G4 on (artifact mode)** it must resolve to a fresh,
threshold-passing evidence artifact. A requirement whose declared method has
no mechanism blocks entry to Phase 4 — a spec file restating the requirement
does not count as verification.

### 2.1 {{Area, e.g. System Data Management}}

| ID | Phase | Area | Description | Verification |
|---|---|---|---|---|
| FR-1 | MVP | {{Area}} | {{One testable behavior. Split compound asks.}} | {{tag(s)}} |
| FR-2 | MVP | {{Area}} | … | … |

### 2.2 {{Next area, e.g. Core Workflow}}

| ID | Phase | Area | Description | Verification |
|---|---|---|---|---|
| FR-n | MVP | … | … | … |

> Rules: IDs assigned once, never renumbered. One testable behavior per FR.
> Note explicit exclusions inside descriptions ("images out of scope").
> Verification tags come only from the closed vocabulary above — an
> undeclared or unknown tag fails `check-acceptance-methods` at G3.

## 3 Non-Functional Requirements (NFR)

| ID | Category | Description | Verification |
|---|---|---|---|
| NFR-1 | Security | {{Password policy: length, classes, reuse}} | local-verifiable |
| NFR-2 | Security | {{Session inactivity timeout}} | e2e |
| NFR-3 | Security | {{Token/link validity windows}} | local-verifiable |
| NFR-4 | Performance | {{App/screen load budgets}} | e2e |
| NFR-5 | Performance | {{Operation-specific budgets}} | local-verifiable |
| NFR-6 | Availability | {{Target + maintenance windows}} | deploy-gated |
| NFR-7 | Compatibility | {{Browsers, OS}} | e2e |
| NFR-8 | Compatibility | {{Devices: PC, tablet, touch}} | vision-verify |
| NFR-9 | Usability | {{Onboarding time, customization policy}} | eval |
| NFR-10 | Localization | {{Languages, MVP vs Future}} | e2e |

> Example — a fully declared visual-fidelity NFR (this exact shape is what
> `check-acceptance-methods` needed to catch the pixel-perfect failure):
>
> | ID | Category | Description | Verification |
> |---|---|---|---|
> | NFR-19 | Visual fidelity | Rendered pages match the reference site at ≥ 99% pixel similarity (pixel-diff vs reference) at all declared breakpoints; a fresh-agent vision pass confirms the settled render | local-verifiable, vision-verify |
>
> At G3 the `local-verifiable` tag must resolve to a real pixel-diff script
> (not an `echo` stub); from G4 on it must resolve to a fresh
> `docs/qa/visual-diff/*/report.json` with score ≥ threshold AND a vision
> report with `met: true`.

## 4 Constraints

### 4.1 Technical Constraints

| ID | Description |
|---|---|
| TC-1 | {{e.g. no low-code; conventional stack}} |
| TC-2 | {{integrations that MUST exist}} |
| TC-3 | {{explicit out-of-scope: imports, images, …}} |

### 4.2 Business Constraints

| ID | Description |
|---|---|
| BC-1 | {{phasing: MVP first, Future Phase contents}} |
| BC-2 | {{change-control policy post-launch}} |

## 5 Assumptions & Notes for Estimation

- {{Everything inferred rather than stated — make it explicit.}}
- {{MVP scope summary in one bullet; Future Phase summary in one bullet.}}
