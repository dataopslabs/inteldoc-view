# DocOps UI Design System Selection

Based on the DocOps Agentic Document Intelligence Platform requirements (traces, HITL reviews, observability, workspaces), the following design systems from [awesome-design-md](https://github.com/VoltAgent/awesome-design-md/tree/main) are recommended.

---

## Top Picks

### 1. Linear — Best Overall Fit
`design-md/linear.app/DESIGN.md`

The precision dark-mode aesthetic was literally built for developer platforms that surface traces, pipeline states, and technical data. Its characteristics match DocOps perfectly:
- Near-black canvas (`#08090a`) for dense dashboard data without eye strain
- Indigo accent (`#7170ff`) maps well to status indicators and CTAs
- Information hierarchy through luminance gradients — ideal for trace trees and HITL queues
- Inter at weight 510 — exactly the right density for a data-heavy platform

### 2. Sentry — Direct Analogue
`design-md/sentry/DESIGN.md`

Sentry is functionally the closest to DocOps (observability + traces + error states). Its dark purple-black palette with lime accent CTAs is purpose-built for:
- Trace explorers and pipeline status displays
- Alert/confidence states (the lime `#c2ef4e` is great for confidence scores)
- Developer tool "late night debugging" context

### 3. Supabase — Developer Platform Feel
`design-md/supabase/DESIGN.md`

If you want the "open-source developer infrastructure" tone:
- HSL-based translucent layering great for modal overlays (HITL review panels)
- Emerald accent aligns with a "processing complete" / success state
- Terminal-native aesthetic fits the AI pipeline context

---

## Avoid for This Use Case

| Design | Why it doesn't fit |
|---|---|
| **Notion** | Document-editing warmth ≠ processing pipeline confidence |
| **Claude** | Parchment/editorial — better for a chat UI, not a data platform |
| **PostHog** | Quirky/olive palette doesn't suit enterprise B2B |
| **Stripe** | Fintech luxury — wrong domain signal |

---

## Usage Strategy

**Recommendation**: Use [Linear's DESIGN.md](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/linear.app) for the overall shell (sidebar, dashboard, cards), and reference [Sentry's](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/sentry) for the trace explorer and HITL review panel components specifically. The two share the same dark-mode DNA so they blend cleanly.

### How to Apply
1. Copy the chosen `DESIGN.md` into the project root (`ui/DESIGN.md`)
2. Tell your AI agent: "Build this page following the DESIGN.md in the project root"
3. The agent reads the design system and generates consistent, on-brand UI

### Per-Component Mapping

| DocOps Component | Recommended Design Source |
|---|---|
| Sidebar, dashboard shell | Linear |
| Trace explorer, pipeline status | Sentry |
| HITL review panels, modals | Sentry or Supabase |
| Workspace cards | Linear |
| Confidence score badges | Sentry (lime accent) |
| Auth / onboarding | Linear or Supabase |
