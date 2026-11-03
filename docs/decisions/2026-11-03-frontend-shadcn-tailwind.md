# 2026-11-03: Frontend design system is Tailwind + shadcn primitives under `components/shadcn`

## Context

The BioAvanceD frontend shipped as page-local CSS plus a thin `components/UI` kit. Evidence screenshots and CI UI captures showed low density, inconsistent chrome, and a green brand that did not match `LOGO_BIOAVANCED_CORE.png`. Routes, RBAC, i18n and E2E selectors had to stay stable.

## Decision

1. Adopt **Tailwind CSS** with institutional tokens from the logo: primary `#371667`, hover `#2A104F`, soft `#F4F1F8`; muted violet/cyan only as accents; semantic success/warning/danger.
2. Place shadcn-style primitives in **`frontend/src/components/shadcn/`** (not `components/ui`) because Windows is case-insensitive and would collide with `components/UI`.
3. Keep **`components/UI/*` as compatibility facades** that re-export or wrap shadcn while preserving existing prop APIs (`variant: primary|secondary|danger|success`, `label`, `error`, etc.).
4. Preserve all routes in `App.tsx`, `ProtectedRoute`, and `data-testid` used by Playwright.
5. **Do not add new page-level `.css` files** or layout/color `style={{}}` in new work. Prefer Tailwind utilities and shadcn primitives.

## Consequences

- Shell (`Layout` / `Sidebar` / `Header`) and Login/Dashboard are the visual source of truth for the SaaS chrome.
- Remaining views may still use legacy class names present in `App.css` during coexistence; those class hooks are transitional and should shrink as pages are rewritten.
- MUI stubs in `optional-ui-modules.d.ts` are obsolete and removed.
