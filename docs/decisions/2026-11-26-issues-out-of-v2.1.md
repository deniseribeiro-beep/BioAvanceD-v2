# 2026-11-26: GitHub issues — out of v2.1 scope (G12)

## The question

Which open issues from the PHR-004 snapshot are **in** vs **out** of BioAvanceD 2.1 go-live?

## Decided

`[decision]`, coordinator, 2026-11-26:

| # | Label | Decision |
|---|-------|----------|
| 1583 | bug | **IN** — fix or close with evidence before tag; if unreproducible on tip, close with MANUAL_VERIFY note |
| 1465 | bug TLS | **OUT** — ADR `2026-11-26-tls-1465-defer-post-2.1.md` |
| 1542 | enhancement FE | **OUT** post-2.1 unless already shipped by G5–G13 |
| 1566 | enhancement converters | **Partial IN** — SIGTAP/MarkerDB via G1/G2; CPATH/FDA_PGX via G3 ADR N/A |
| 1562 | enhancement mongodump | **OUT** post-2.1 (Zenodo pack not go-live) |
| 1561 | enhancement perf | **OUT** post-2.1 |
| 1407 | enhancement DatasetSnapshot | **OUT** post-2.1 |

Owner for OUT items: product lead; revisit after `v2.1.0` tag.

## Consequences

- G12 closes when IN items have evidence and OUT items are labeled/commented with this ADR.
- Do not block tag on OUT rows.
