# 2026-11-26: Lab inventory lookup — drawer (P5.5)

## The question

How should barcode/quick lookup open without a third search engine after unifying inventory search (G5)?

## Decided

`[decision]`, coordinator, 2026-11-26:

1. **Drawer** on the inventory hub (not popup window, not separate PWA in 2.1).
2. Same search motor as the inventory list (G5) — no third query path.
3. Deep-links to sample detail, storage, and label; same session/keepalive.
4. Order: ship after G5 (single search).

## Consequences

- `SampleLocator` duplicate search on tab 2 is retired or selection-fed only.
- `/samples/lookup` as standalone popup is out of 2.1.
