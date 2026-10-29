# 2026-10-23: the W8 showcase case shows the storage picker, the derived status and closing, and names disposition, custody and the physical chain as not demoed

Requirement RF017, RF006 AC2/AC3, RF026 AC7. Issue #1399.

## The question

The showcase reel (`tests/e2e-showcase/human-showcase.spec.ts`) had no W8 case (physical storage, specimen state and custody v2). The issue's done rule asks for a case "placing a specimen through the container, position and rack chain" and, "if the UI offers it", a disposition. Which W8 flows does the case walk through the UI?

## Decided

`[inference]`, from the frontend at base and the reel's own pattern, by the coordinator for #1399, on 2026-10-23. The pattern: the reel's Wave 2, Wave 3, W6 and W9 headers show only flows the UI exposes, and name the rest as not demoed rather than fabricate a UI path for them.

1. **Placement is the freezer > shelf > rack > box > position picker.** It is the UI's only placement walk: `InlineStorageMovementPanel` on `/samples/:id`, which calls `POST /api/storage/move` for a stored specimen. The case moves a specimen seeded in one box to a named freezer, shelf, rack and box at B3, and reads the move back through `GET /api/storage/sample/:id`.
2. **Specimen state is the derived "Status Atual" and closing a depleted specimen.** The case reads `Disponível`, then `Totalmente Retirada` after a total withdrawal made off camera through the API, and closes the specimen with `sample-detail-close-button`, which ends at `Encerrada` (RF026 AC7).
3. **Disposition, custody assignment and the cryovial container, position and rack-to-location chain are not demoed, not even through the API.** No frontend file calls `/api/disposition-actions` or `/api/physical-chain` (`git grep -n -I -E "physical-chain|disposition-actions" -- frontend/src` exits 1 at base). The case header names them, and `tests/e2e/physical-chain.spec.ts` and `tests/e2e/specimen-status-v2.spec.ts` cover them at the API.

## Not decided here

- **A UI for disposition actions**, and with it a disposition run from planned to executed in the reel.
- **A UI for custody assignment.**
- **A UI for the physical chain** (cryovial container, position, rack-to-location).
