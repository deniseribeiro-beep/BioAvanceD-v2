# docs-extract

Turns a binary docs release (`.xlsx`, `.docx`) into Markdown that `grep`
and code review can read. The workbooks and Word documents stay the
authority. The Markdown is a derived copy, regenerated rather than edited.

```bash
python scripts/docs-extract/extract_docs.py docs docs/extracted-v2.0.0
```

- Each workbook sheet becomes `<prefix>-<SHEET>.md`. The data dictionary's
  element table, for example, is `dict-DICIONARIO.md`.
- Each Word document becomes `<prefix>.md`, via pandoc.
- `INDEX.md` records each source's sha256. A mismatch against the release's
  `RELEASE_MANIFEST.json` means the extraction is stale: re-run.

Requires Python with `openpyxl`, plus `pandoc` on `PATH`.
