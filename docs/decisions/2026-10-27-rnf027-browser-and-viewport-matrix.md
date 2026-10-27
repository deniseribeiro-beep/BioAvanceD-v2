# 2026-10-27: RNF027's browser matrix is the three engines the pinned Playwright image ships, and its institutional viewports are 1920x1080, 1366x768 and 1024x768

Requirement RNF027 C4, C5. Issue #1324.

## The question

RNF027 C4 asks the application to support the two latest stable versions of the browsers that "a matriz de suporte" defines, and C5 asks the layout to stay usable at the "resoluções institucionais previstas". Nothing under `docs/` defines either the matrix or the resolutions. Which browsers and which viewports does `tests/e2e/rnf027-interface.spec.ts` prove?

## Decided

`[inference]`, from the repo's pattern, on 2026-10-27:

1. **Browsers: Chromium (Chrome, Edge), Firefox and WebKit (Safari).** The repo pins its e2e browsers through `Dockerfile.playwright`, whose Playwright image ships these three engines, and names each through Playwright's `devices` entries (`Desktop Chrome`, `Desktop Firefox`, `Desktop Safari`). `playwright.config.ts` runs the RNF027 spec in all three; every other spec stays Chromium-only. Each engine is proved at the one version the pinned image carries.
2. **Viewports: 1920x1080, 1366x768 and 1024x768.** The first two are the common desktop sizes. 1024x768 is the width at which `Sidebar.css` and `Layout.css` collapse the sidebar behind its toggle (their `max-width: 1024px` media queries), so it is the narrowest layout the frontend designs for. At each, `/login` and `/dashboard` have no horizontal overflow, and the sidebar's links are reachable: directly above 1024, through the toggle at 1024.

## Not decided here

- **C4's "two latest stable versions":** the image pins one version of each engine, so the previous stable version is not proved.
- **C3, testing critical components with representative assistive technologies.**
- **Contrast and the automated accessibility rule checks:** they wait on adding an axe dependency.
