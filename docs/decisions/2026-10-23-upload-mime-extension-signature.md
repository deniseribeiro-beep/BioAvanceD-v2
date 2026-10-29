# 2026-10-23: an upload's extension, MIME and leading bytes must agree

Requirement RF007 AC1, RNF029 C1. Issue #1321.

## The question

RF007 AC1 asks to "Validar tamanho, MIME, extensão e política de formato", and RNF029 C1 to "Validar tamanho, MIME, extensão e formato". The analysis upload's filter in `api/backend/src/config/uploadConfig.js` accepted a file whose extension OR MIME was allowed, so `report.pdf` sent as `application/unknown` and `data.xyz` sent as `text/csv` both passed. The sample-file filter (`api/backend/src/controllers/sample-file.controller.js`) and the Assay/Dataset filter (`api/backend/src/controllers/createLinkedFileController.js`) checked the extension only, so `fake.pdf` sent as `text/csv` passed, and no path read the file's bytes. Which MIMEs are allowed for each extension, and what does "formato" check?

## Decided

`[inference]`, from the specification and the repo's code, by the coordinator for #1321, on 2026-10-23:

1. **The extension AND its MIME must both be allowed.** The per-extension table is `FORMAT_POLICY` in `api/backend/src/utils/uploadFormatPolicy.js`, covering every extension the three upload paths allow. It is read off the MIMEs `uploadConfig.js` already allowed, plus each format's registered type. `application/octet-stream` is accepted for every extension and `text/plain` for every text format, since `uploadConfig.js` already allowed both as generic labels a browser sends for a type it does not know. The labels browsers send in practice are also accepted: `application/vnd.ms-excel` for `.csv` (Windows) and `text/vcard` and `text/x-vcard` for `.vcf`. A MIME's parameters (`; charset=utf-8`) are dropped before the check. Each filter keeps its own extension list; `uploadConfig.js` keeps its blocked-extension rejection first.
2. **"Formato" is the file's leading signature.** After multer writes the file, its first 8192 bytes are read (never the whole file, since uploads go up to 500 MB). Each binary format must carry its magic number (`%PDF-` within the first 1024 bytes, PNG, JPEG, ZIP, OOXML, OLE2 for `.xls`, RAR, gzip for `.fastq.gz`, `.vcf.gz` and BGZF `.bam`, HDF5 at offset 0, 512, 1024, 2048 or 4096, and `FCS`). A text format must hold no NUL byte unless it starts with a UTF-16 BOM. `.raw` has no signature, because vendor raw formats share none. `.raw` and every binary format are refused when their head starts with an executable signature (MZ, ELF, Mach-O, `#!`). A text format is refused on a NUL byte or a `#!` head, but not on the bare ASCII of a binary magic: a real PE, ELF or Mach-O header holds NUL bytes, while a header row such as `MZ,Intensity` is ordinary mass-spectrometry data. An unreadable file fails closed.
3. **A refused upload is removed and answered 400.** The file removed is the one just written for this request, before any row records it, so it is not evidence; a replace never touches the previous binary. The analysis upload answers `Invalid file content`; the sample and Assay/Dataset paths answer `Conteúdo do arquivo não corresponde ao formato <ext>`, and their MIME refusal is `Tipo MIME <mime> não permitido para a extensão <ext>`.

## Not decided here

- **The other upload paths:** the Result upload (`api/backend/src/interface/routes/result.routes.js`) and the import uploads (`api/backend/src/controllers/import*.controller.js`, `api/backend/src/controllers/fhir-import-staging.controller.js`) keep their own filters.
- **A part with no Content-Type** reaches multer as `text/plain` (busboy 1.6's default), so it is refused for a binary extension.
- **Malware scanning** (RNF029 C4).
