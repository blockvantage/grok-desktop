# Onboarding SOTA → Grok Desk activation (2026-07-12)

## Principles (industry consensus 2025–2026)

Sources synthesized: Appcues / Userpilot / UXCam / DesignerUp 200-flow study / Formbricks / progressive-disclosure research.

| Principle | What SOTA products do | Grok Desk mapping |
|-----------|----------------------|-------------------|
| **Time-to-value &lt; 60s** | First useful outcome, not a tour | First **goal run** in a workspace (artifacts loop) |
| **Minimum required** | Only gates that unlock the product | **Workspace folder** (security boundary); SuperGrok optional |
| **Personalization early** | Role/job quiz makes it “for me” | **Role packs** (Marketing / Research / Ops / CoS) |
| **Progressive disclosure** | Hide power until needed | Approval modes under Advanced; connectors silent-on |
| **Empty state = next action** | Templates / one CTA, not blank UI | Seed **starter goal** into Home compose after setup |
| **Interactive &gt; lecture** | Learn by doing | No multi-step pitch; one activation screen → work |
| **Defaults are smart** | Don’t ask for preferences you can choose well | Balanced + recommended MCP connectors |

## Activation definition (Desk-specific)

**Activated** when: user has a workspace root **and** has started (or is one Enter away from starting) a task that can produce deliverables.

## Flow we ship (full-window first open → main shell)

This is a **fresh app launch surface**, not a panel inside Home/chat.

1. **Welcome** — brand + one value line (full window).
2. **Intent** — role lane (personalization).
3. **Workspace** — pick folder (required gate).
4. **Account** — SuperGrok optional; skip OK.
5. **Ready** — summary + **Enter Grok Desk** → view-transition into main shell.

Silent defaults: balanced approval + recommended connectors.  
Starter goal is seeded *after* handoff (compose), never as “chat onboarding.”

## Non-goals

- Setup UI living inside the main app chrome / Home checklist  
- Product tours of Memory / Schedule / Browser on day zero  
- Forcing OAuth before first enter  
