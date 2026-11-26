# 2026-10-30: backend coverage reads `require`d files against the file on disk

Issue #1337.

## The question

`api/backend` measures coverage with `@vitest/coverage-v8` 4.1.10 under vitest 4.1.9. Most backend tests load their source through Node's own `require`, so V8 measures the original file: for `src/config/validateEnv.js` the root range is 0..14813, the file's length on disk. The stock provider then remaps those offsets against vitest's Vite transform of the file, which strips comments and reprints the code (8645 chars for `validateEnv.js`). Every count is looked up at the wrong place in the text. A probe test that called `validateRedisEnv` three times with no `REDIS_URL` saw line 26's `if (redisUrl)` read `[1,0]`, where the true count is `[0,3]`. The arms read wrong in both directions: the stock reading credits arms that never ran, zeroes arms that did, and gives negative counts (114 in the full report). The branch numbers that #1337 sizes its test work from cannot be trusted. Do we fix the measurement before writing more tests, and how?

## Decided

By Dennis, on 2026-10-30:

1. **A small custom coverage provider fixes the reading.** `api/backend/tests/support/coverage-native-require.mjs` re-exports `@vitest/coverage-v8` and wraps its provider's `remapCoverage`. A script with no module-runner wrapper (`wrapperLength` 0), whose widest root range ends exactly at the length of the file on disk, is remapped against that file's text with no source map. Every other script goes to the stock method unchanged. `api/backend/vitest.config.js` loads it with `provider: 'custom'` and `customProviderModule`. Every other coverage option, the thresholds included, stays as it was.
2. **Measured on the real tests.** On `tests/unit/validateEnv.test.js`, `validateEnv.js` goes from 84/104 branch arms with 2 negative to 102/104 with none, and line 26 from `[1,0]` to `[13,18]`, the count a scratch copy of the test recorded by trapping the `REDIS_URL` read. On the 19 `tests/unit/import-lgpd*` files, `src/services/import-lgpd.service.js` goes from 969/1102 with 22 negative to 1016/1102 with none.
3. **The cost is small.** On the probe's 23-file sample the run took about 48 s, against 42 s with the stock provider (one run each). The extra work is one file read per script. No test changes, and no package changes.
4. **An upgrade that moves the private method fails loudly.** If the stock provider has no `remapCoverage` function, the module throws an Error that names the installed `@vitest/coverage-v8` version. The coverage run then breaks, instead of quietly going back to the wrong reading.

## Not decided here

- **The wrapper depends on a private method.** `remapCoverage` is not part of `@vitest/coverage-v8`'s public interface, so an upgrade can change its signature or meaning without removing it, and only the missing-method case is caught. Any upgrade of `vitest` or `@vitest/coverage-v8` re-checks this reading. The installed pair is already mismatched (4.1.9 with 4.1.10), and vitest warns about mixed versions on every run.
- **A file loaded both through `require` and through `import` in one run** has its two readings merged by URL from two different texts. Its root range then does not match the file on disk, so it goes to the stock path and may still read wrong.
- **The thresholds,** which are raised later from a full-suite run with this provider. The provider only corrects the reading. It does not cover any more code.
