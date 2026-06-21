# Requirements Document

**{{PROJECT_NAME}}**

*Prepared for estimation and spec-driven delivery*

## 1 Company Business Overview

{{2-4 paragraphs: who the customer is, how they operate today, the pains,
what the platform must do end-to-end, MVP vs Future Phase boundary.}}

## 2 Functional Requirements (FR)

Requirements are grouped by functional area. 'Phase' indicates MVP or Future.

### 2.1 {{Area, e.g. System Data Management}}

| ID | Phase | Area | Description |
|---|---|---|---|
| FR-1 | MVP | {{Area}} | {{One testable behavior. Split compound asks.}} |
| FR-2 | MVP | {{Area}} | … |

### 2.2 {{Next area, e.g. Core Workflow}}

| ID | Phase | Area | Description |
|---|---|---|---|
| FR-n | MVP | … | … |

> Rules: IDs assigned once, never renumbered. One testable behavior per FR.
> Note explicit exclusions inside descriptions ("images out of scope").

## 3 Non-Functional Requirements (NFR)

| ID | Category | Description |
|---|---|---|
| NFR-1 | Security | {{Password policy: length, classes, reuse}} |
| NFR-2 | Security | {{Session inactivity timeout}} |
| NFR-3 | Security | {{Token/link validity windows}} |
| NFR-4 | Performance | {{App/screen load budgets}} |
| NFR-5 | Performance | {{Operation-specific budgets}} |
| NFR-6 | Availability | {{Target + maintenance windows}} |
| NFR-7 | Compatibility | {{Browsers, OS}} |
| NFR-8 | Compatibility | {{Devices: PC, tablet, touch}} |
| NFR-9 | Usability | {{Onboarding time, customization policy}} |
| NFR-10 | Localization | {{Languages, MVP vs Future}} |

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
