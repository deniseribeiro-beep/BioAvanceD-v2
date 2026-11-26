# 2026-11-13: RNF027 C3's instrument is an assertion on the browser's accessibility tree, in Playwright, on login, the intake wizard's sample step and the participant consent page

Requirement RNF027 C3. Issue #1473.

## The question

RNF027 C3 asks that "Componentes críticos são testados com tecnologias assistivas representativas". C1, C2, C4 and C5 have their instruments (`tests/e2e/rnf027-interface.spec.ts`, `2026-10-27-rnf027-axe-scan.md`, `2026-10-27-rnf027-browser-and-viewport-matrix.md`); C3 had none. Which components are critical, and what tests them as an assistive technology meets them?

## Decided

`[inference]`, for #1473 on 2026-11-13, from the repo's pattern of proving each RNF027 criterion with an automated Playwright check that runs at the e2e gate.

1. **Instrument: Playwright assertions on the accessibility tree.** A screen reader, a voice-control tool and a switch device all reach the page through the accessibility tree the browser builds, not through the DOM. `tests/e2e/rnf027-assistive-technology.spec.ts` asserts on that tree as Playwright exposes it (`toHaveRole`, `toHaveAccessibleName`, `toHaveAccessibleDescription`, `getByRole`): each control's role; each control's accessible name, equal to the text of its visible `<label>` where it has one and never the shared `Input`/`Select` fallback ("Campo de entrada", "Campo de seleção"); the state a control announces (checked, disabled); and messages announced as `alert` or `status`. A manual screen-reader protocol was not chosen: it would not run at the gate, and nothing in the repo records a manual pass for any other criterion.
2. **Critical components: login (`/login`), sample registration (the intake wizard's sample step, `/next/intake`, step 2) and consent (the participant consent page, `/patients/:id/consent?token=`).** Login gates every other flow; the sample step is where a specimen is registered; the consent page is the one a participant, with no account, uses to accept or revoke the term.
3. **Browser: Chromium.** Each engine builds its own tree, but the names and roles asserted come from the markup, which is the same in all three; the engine matrix stays the interface spec's.
4. **The cases run against the real backend stack at the e2e gate, with no routed call.** Login is answered by a real 401 for an account that does not exist; the wizard runs on a real session, with a seeded governed collection in its collection list; the consent page opens a link for a participant created through the API under a seeded term with a required and an optional purpose. Without a backend the spec is skipped, as the repo's other real-backend specs are.

The spec found three controls on the sample step that a screen reader could not name, each fixed in `ClinicalIntakeWizard.jsx`:

- the SPREC axis 4 (centrifugation) select had a visible label tied to nothing, so it was read as "Campo de seleção";
- the "Processing information unknown" checkbox had no accessible name;
- the quantity field's `aria-label` fallback ("Campo de entrada") overrode its visible label.

## Not decided here

- **A manual pass with a named screen reader (NVDA, JAWS, VoiceOver).** The accessibility tree is what each of them reads, but their own reading order and verbosity are not checked.
- **The wizard's patient and biomarker steps, the e-consent page (`/patient/e-consent/:token`) and every other page.**
- **Firefox and WebKit's own accessibility trees.**
