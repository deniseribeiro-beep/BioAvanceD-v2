---
name: playwright-specs
description: Conventions and quirks for writing/maintaining Playwright spec files in this repo (selectors, mocked auth, page.route gotchas). The spec-authoring counterpart to e2e-docker-workflow (Docker/CI infra) and testing-conventions (what to run, when). Use when writing or editing any tests/e2e/*.spec.ts file.
---

# Playwright spec-authoring conventions

Where this fits: `e2e-docker-workflow` owns Docker/compose/module-resolution
concerns, `testing-conventions` owns test tiers and what to run per
iteration vs. at the gate. This skill owns the actual craft of writing a
`tests/e2e/*.spec.ts` file against this frontend — selector choices, the
mocked-auth pattern, and the frontend-behavior gotchas that have already
cost a wrong assertion once. Read all three for e2e work; don't duplicate
content across them — cross-reference instead.

## Spec inventory (keep this list current)

- `tests/e2e/backend-integration.spec.ts` — real-backend API-only (no
  `page` fixture), skips unless `PLAYWRIGHT_API_BASE_URL` is set.
- `tests/e2e/cadastro-amostra.spec.ts` — samples list (`/samples`),
  mocked.
- `tests/e2e/intake-wizard.spec.ts` — intake wizard demographic step
  (`/next/intake`), mocked.
- `tests/e2e/tcle-dinamico.spec.ts` — TCLE builder (`/admin/tcle/new`),
  mocked.
- `tests/e2e/helpers/mockAuth.ts` — shared mocked-auth helper (see below).

Update this list in the same commit that adds/removes a spec file —
it's the fastest way to know what's already covered before picking a
next slice under issue #95.

## Config location and module resolution — don't move the config into `frontend/`

`playwright.config.ts` and the `@playwright/test` devDependency must stay at the
**repo root**, not under `frontend/`, even though the app it drives lives there.
Node's module resolution walks up from the *importing file's* location looking
for `node_modules`. `tests/e2e/*.spec.ts` is a sibling of `frontend/`, not a
descendant, so `frontend/node_modules` is never in its ancestor chain —
`import { test } from '@playwright/test'` fails with `ERR_MODULE_NOT_FOUND` if
the config (and the devDependency) move to `frontend/`, even though `testDir`
would still correctly point Playwright at the files. Root is the common
ancestor of both `tests/e2e/` and `frontend/` — that's why it has to live there.

`testDir` inside the config also resolves **relative to the config file**, not
the cwd you run `playwright test` from — easy to misread `testDir:
'./tests/e2e'` as cwd-relative. Verify with `npx playwright test --list` after
moving either the config or the specs.

## There is no real-login flow yet — don't assume `global.setup.ts` still exists

A now-removed skill note once pointed at `frontend/playwright/global.setup.ts`
as a working `PLAYWRIGHT_USE_REAL_LOGIN=1` + `TEST_USER`/`TEST_PASS` real-login
mechanism. Confirmed 2026-07-09: that file was deleted in commit `b69513a5`
(the same main-side pass that emptied `tests/e2e/` per issue #95), and nothing
recreated it — no global-setup project is wired into `playwright.config.ts` at
all. The config's old `use.storageState: 'playwright/.auth/user.json'` default
was a dead pointer at this now-gone setup's output; it threw `ENOENT` for every
UI spec using the `page` fixture and was removed in the #95 scaffolding work.
If a real-backend login flow is needed later, it has to be built from scratch
— and blocks on issue #144 (no seed script yet for a known test user). Don't
assume the old mechanism is still there; grep for `global.setup` to confirm
before relying on a memory of this note.

## Mocked auth — use `mockAuth.ts`, don't build a second mechanism

`tests/e2e/helpers/mockAuth.ts`'s `mockLogin(page)` seeds a
client-decodable (unsigned) JWT into `localStorage` via
`page.addInitScript`, before any app script runs. This works because:

- `AuthContext.tsx`'s `decodeUserFromToken` parses the JWT payload
  client-side and populates a fallback `user` immediately — it does not
  wait for the network `/api/auth/verify` call to resolve.
- `ProtectedRoute.tsx` only blocks rendering on `isLoading` (AuthContext's
  own flag, resolved quickly), never on the verify call. So **you don't
  need to mock `/api/auth/verify` for a protected route to render** —
  `mockLogin` does it anyway to suppress console noise/race timing, but
  skipping it wouldn't break rendering.
- The payload needs `accessType` (1-4) or `roleName` for role-gated
  routes — `mockAuth.ts`'s `ADMIN_USER` uses `accessType: 4`
  (Administrador) to clear every role check. Use a lower `accessType` if
  a spec specifically needs to assert a role is *denied* access.

There is no real-login flow available yet for real-backend specs — a
prior skill note pointed at `frontend/playwright/global.setup.ts`, but
that file was deleted in the same main-merge that emptied `tests/e2e/`
(see `e2e-docker-workflow`'s gotcha on this). Building one is blocked on
issue #144 (no seed script yet for a known test user).

## Selector conventions — testids first, but verify they exist

Most interactive frontend components carry `data-testid` — grep the
component file for `data-testid=` before writing a locator, don't guess
from the visible label text (i18n keys mean label text isn't reliable
across locales — see issue #5's root cause: specs guessed at Portuguese
label text and broke).

`getByLabel(...)` also works reliably on this repo's shared `Input`
component (`frontend/src/components/UI/Input.tsx`) because it renders a
real `<label htmlFor={inputId}>` — useful exactly where `data-testid` is
missing.

**Not every page has testids.** Confirmed 2026-07-09:
`TcleBuilderPage.tsx` has zero `data-testid` attributes anywhere in the
file — `tcle-dinamico.spec.ts` uses `getByLabel(...)` and
`getByRole('button', { name: ... })` instead. Check with a grep for
`data-testid` in the target component before assuming one exists; if a
page has none and you're about to write several specs against it,
that's worth a quick note to Dennis about adding them rather than
building a brittle role/text-based spec by default.

## `page.route` gotcha: confirm the call actually fires before mocking it

Before writing a `page.route('**/api/...')` mock and asserting on the
intercepted request, confirm the frontend actually makes that request
for the interaction you're testing — some "search"/"filter" UI is
client-side-only against data already fetched once on mount. Confirmed
2026-07-09: the samples list search box (`SamplesPageView.tsx`) looks
like it would re-query the API, but `useSamplesPage.ts`'s
`filteredSamples` is a `useMemo` filtering the already-loaded `samples`
array in memory — `sampleService.getAll()` takes no params and is never
called again on search. A test that asserted on a new network request
here would have been silently wrong (or hung waiting on a request that
never comes). Trace the click handler into its hook/service call once,
briefly, before writing the assertion — don't assume "looks like a
search box" means "hits the API."

When it does hit the API, match `extractResponseItems`'s flexible
unwrapping (`frontend/src/api/response.adapters.ts`) — it accepts an
array at `data`, `data.data`, `data.items`, `data.results`, or a few
named keys (e.g. `data.samples`). Mocking `{ success: true, data: {
samples: [...] } }` (or a bare array) covers the common cases.

## Disabled-submit gotcha: check the `disabled=` condition, not just the visible fields

A submit button can stay disabled behind fields that are visible but not
in the form's "first step" — trace the actual `disabled={...}` expression
in the component before assuming the fields you can see are the fields
required. Confirmed 2026-07-09: `TcleBuilderPage.tsx`'s create-template
button requires `title`, `validFrom`, `validTo`, a non-empty rich-text
body (`contentEditable`, not an `<input>`), **and** at least one
non-empty granular consent item — all five, not just the two metadata
inputs that are visually foregrounded. A test that filled only the
visible name/CAAE fields and then clicked submit would hang retrying a
disabled-button click until the 30s test timeout, not fail fast with a
clear error.

## Filling a `contentEditable` rich-text editor

Playwright's `.fill()` works on a `contentEditable` element with
`role="textbox"` — locate it with
`page.getByRole('textbox', { name: <aria-label> })` the same as a real
input, e.g. TCLE builder's body editor
(`aria-label="Editor do corpo do TCLE"`).

## Maintaining this skill

New spec added → update the inventory above in the same commit. New
frontend-behavior surprise found while writing a spec (a hidden API
call, a non-obvious disabled condition, a missing testid) → add it here
as its own dated gotcha, the same session it's found — don't let it live
only in a commit message or PR description.
