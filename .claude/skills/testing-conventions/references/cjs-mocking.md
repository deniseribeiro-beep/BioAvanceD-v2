# CJS mocking gotchas (Vitest + CommonJS sources)

Read this file in full before writing or briefing any test that mocks,
spies, or stubs backend code. Every entry below was confirmed the hard
way in this repo — trust it over instinct. When briefing a test-writer
subagent, give it this file's path to Read; don't paraphrase from
memory (incident `vi-mock-briefed-from-memory`,
`bioavanced-conventions/references/incidents.md`).

## Test files are ESM-only, sources are CJS

Vitest cannot be `require()`d — a test file written in CommonJS
(`const { describe } = require('vitest')`) fails outright with "Vitest
cannot be imported in a CommonJS module using require()". Test files
must use `import { describe, it, expect, vi } from 'vitest'`, and load
the CJS sources under test via
`createRequire(import.meta.url)` (see existing tests, e.g.
`tests/unit/import-lgpd.controller.test.js`, for the pattern). A
subagent hit this cold on 2026-07-03 — include it in any test-writing
brief for this repo.

## `vi.mock()` does not intercept `require()`

Confirmed independently twice (2026-07-02, `scheduler.service.test.js` and
`sendConsentEmail.test.js`): in this repo's Vitest setup, `vi.mock('./x', ...)`
only intercepts ES `import`/dynamic `import()` of `x`. Backend source files
overwhelmingly use CommonJS `require(...)`, which `vi.mock` does not hook —
the mock factory silently never runs and the real module executes underneath
it (real logger, real timers, real network calls). Symptom: mocked functions
report zero calls even though the code path clearly ran.

Workaround, not a fix — Node's CJS module cache guarantees the test file and
the source file under test share the same object instance, so: `require` the
real singleton module and use `vi.spyOn(realModule, 'methodName')` /
`.mockImplementation(...)` directly on it, restoring with
`vi.restoreAllMocks()` in `afterEach`. This applies to the module's own
dependencies too (e.g. a service's internal `require('node-cron')` or
`require('../utils/logger')`) — spy on the dependency's exports the same way
rather than trying to `vi.mock` the dependency's module path.

## `await import(...)` of a CJS source has the same failure mode

**Loading the module under test via `await import(...)` has the same failure mode as
`vi.mock` on CJS** (confirmed 2026-07-03, `security.routes.test.js`): a test file that
does `const foo = (await import('../../src/foo')).default || (await import(...))` gets
a *different module instance* than the one the source's own internal `require(...)`
calls resolve to (Vite's ESM interop wraps a fresh instance around the CJS module
rather than returning the same `require.cache` entry). `vi.spyOn` on that imported
instance then silently no-ops for the same reason as above — the real dependency runs
underneath the "mock." This is easy to miss because the test can still pass if its
assertions are loose enough to also be satisfied by the real implementation's output
(that's exactly how it went undetected in `security.routes.test.js` until stricter
assertions surfaced it — see issue #41). Always load CJS sources under test —
including the router/service file itself, not just its dependencies — via
`createRequire(import.meta.url)`, never `await import(...)`.

## `vi.spyOn` silently fails if the source destructures the import

**`vi.spyOn` also silently fails if the source file destructures the import**
(confirmed independently 3x, 2026-07-02: `RegisterSample.js`, `authConsent.js`,
`iot-streaming.service.js` — all do `const { getCollection } = require(...)` /
`const { getQueue } = require(...)` at module scope). Spying on the exporting
module's method after that destructuring has already run has no effect — the
local binding still points at the original function, so the spy is silently
never called and the real implementation runs underneath it. Symptom looks
identical to the `vi.mock`/`require` gap above (zero calls recorded on a mock
that should have fired) but the root cause is different and the module-object
spy trick above does not fix it. Workaround: stub the *lower-level* call the
destructured helper itself makes (e.g. `db.collection()` instead of
`getCollection()`), or clear `require.cache` for both the dependency and the
module under test and re-require after setting the spy so the destructuring
re-runs against the mocked export.

Before writing any claim about a file's require/destructuring shape into a
brief, re-check the exact lines (`grep -n "require(" <file>`) — asserting it
from earlier general reading has been wrong before (incident
`brief-wrong-destructure-claim`,
`bioavanced-conventions/references/incidents.md`).

## `vi.resetModules()` does not clear Node's real `require.cache`

**`vi.resetModules()` alone does not reliably clear the real Node `require.cache`
entry** (confirmed 2026-07-02, `hpoService.test.js`). If a source file captures a
`process.env` value into a module-level `const` at require time (e.g.
`const HPO_API_URL = process.env.HPO_API_URL || ''`), a test that changes the env
var and calls `vi.resetModules()` + `require(...)` again can still get back a stale
module instance with the old value frozen in. Workaround: explicitly
`delete require.cache[require.resolve(path)]` before every re-require that needs a
fresh read of `process.env`, rather than relying on `vi.resetModules()`.

## Testing a mongoose `pre('save')` hook without a DB connection

**Calling `.save()` to exercise an inline `schema.pre('save', ...)` validator needs a
live DB connection** this repo's unit tests don't have. Confirmed working alternative
(`StorageContainer.model.test.js`, 2026-07-04): the hook function is retrievable
without a connection via `Model.schema.s.hooks._pres.get('save')` — an array that also
contains mongoose's own internal save hooks (`validateBeforeSave`, subdoc saves,
sharding, transactions), so find the target by matching a snippet of its own source
text (`.find(h => h.fn.toString().includes('some string unique to the hook'))`) rather
than trusting a fixed array index, which can shift if mongoose adds/reorders internal
hooks. Call it directly against a plain `new Model(...)` instance:
`await hook.call(doc, () => {})` — hooks that `throw` inside an `async function` reject
the returned promise, so `await expect(hook.call(doc, next)).rejects.toThrow(...)`
works with no `next(err)` plumbing needed. Any `Model.findById`/`Model.find` calls made
*inside* the hook can be `vi.spyOn`'d directly on the required model object, same as any
other CJS singleton spy in this file.

## Faking a whole dependency module via `require.cache` injection

When a route/service captures a **class** by reference at require-time
(`const Foo = require('./Foo')` used later as `new Foo(...)`), the
destructuring workaround above doesn't apply directly — you need the
whole module replaced before the file under test re-requires it.
Confirmed working (`sample.routes.test.js`, 2026-07-04): assign a fake
Module-like object straight into `require.cache[require.resolve(path)]`
(`{ id, filename, loaded: true, exports: <fake> }`) for each dependency,
then `delete require.cache[require.resolve(routeFile)]` and
`require(routeFile)` fresh so its top-level `require(...)` calls resolve
to the fakes. **The `exports` value must be a real `function`/`class`,
not a `vi.fn()` arrow-function mock** — `new (() => {})()` throws "is not
a constructor" (arrow functions can't be used with `new`; only
`function`/`class` can). Use `function Fake() { this.method = vi.fn(); }`
or a real `class`, not `vi.fn().mockImplementation(() => ({...}))`.

## `require.cache` injection also works for third-party npm packages, not just app-local files

**Confirmed 2026-07-05, `import-batch.controller.js`**: needed to exercise the closures
passed to `multer.diskStorage({destination, filename})` and `multer({fileFilter})`,
which the controller keeps at module scope and never exposes. `vi.doMock('multer', ...)`
and dynamic `import()` both silently no-op for the same root cause as the sections above
(this file's test loads the controller via `createRequire`, i.e. real Node CJS, which
Vite's mock graph never touches) — wasted two full edit/run cycles confirming that before
switching approaches. The same `require.cache` injection technique from "Faking a whole
dependency module" above works unchanged for a real `node_modules` package, not just
app-local files: grab the real `require.cache[require.resolve('multer')]` module record,
temporarily overwrite its `.exports` with a thin wrapper that captures the config object
and then calls straight through to the real original function (don't stub the behavior —
the real `multer()`/`.diskStorage()` still need to run so the returned `upload` object is
genuine), `delete require.cache[require.resolve(<controller path>)]` and re-require it so
its top-level `require('multer')` picks up the wrapper, then restore the original
`.exports` in a `finally`. This captures the exact closures without needing the module to
export them.

## Mixing `import` and `createRequire` for the same source across split test files silently under-reports coverage

**Confirmed 2026-07-05, `sensor.service.js`**: `sensor.service.test.js` loaded the
singleton via `createRequire(import.meta.url)` while `sensor.service.quarantine.test.js`
loaded the same file via plain ESM `import`. Both files' tests passed fine, but running
them together for coverage reported only 64.55% lines — running `sensor.service.test.js`
alone reported 92.4% (missing only the lines the quarantine file's tests exercised). v8/vitest
does not merge coverage across the two loader paths for the same source file, so the
combined number silently undercounts rather than erroring. Symptom: a file's isolated
combined-coverage run looks stuck at a moderate percentage despite tests that clearly cover
the missing lines when read. Fix: make every test file for a given CJS source use the same
loading style — prefer `createRequire(import.meta.url)` everywhere per the ESM/CJS section
above — and if a MID-LOW/LOW file has multiple test files, check they agree before trusting
the combined isolated-run percentage.

## Maintaining this file

New mocking/module-cache gotchas confirmed in this repo go here (full
detail, incident dates, workarounds). The one-line index in
`testing-conventions`' SKILL.md must gain a matching line in the same
edit — the index is how a session knows this file needs reading.
