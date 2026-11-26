# 2026-11-26: SRC_CPATH / SRC_FDA_PGX — N/A in v2.1 (G3)

## The question

Must CPATH and FDA_PGX dumps be imported for BioAvanceD 2.1 go-live?

## Decided

`[decision]`, coordinator, 2026-11-26:

1. **N/A for release 2.1.0.** Official dumps are absent under `docs/data/`; converter is stub-only (`convertCpathFdaStub.js` → empty JSONL).
2. Do **not** invent rows or ship fictitious CPATH/FDA_PGX associations (#1206).
3. FONTES entries remain planned for a **post-2.1** release when dumps are licensed and staged.
4. Closes must-have **G3** via this signed ADR (not via import).

## Consequences

- Issue #1566 (converters) may close for CPATH/FDA_PGX subset with pointer here; SIGTAP/ATC/MarkerDB remain in-scope via G1/G2.
- Stub converter stays for RF028 hook compatibility; no prod import job for these sources in 2.1.
