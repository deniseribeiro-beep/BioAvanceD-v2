# HANDOFF

**Written 2026-09-23, forty-fifth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was to read the
handoff and continue, with Docker on. #1174 still had no reply, so the sitting
took the backlog's one bug that needed no design call (#1065), plus the two
issues its audit filed.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`028dcc72`.

## What shipped

- **#1065 CLOSED, `ab385246`**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1065)):
  `batch-validation-engine.service.js#readCsvRows` now derives the physical line
  from csv-parser's `byteOffset`. The newline index is built by a `Transform` as
  the file streams.
  - Premise corrected: `detectCsvSeparator` reads the whole file and slices the
    string afterwards. It does not read "only 8192 bytes".
- **#1175 filed and CLOSED, `851e4884`**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1175#issuecomment-5804447457)):
  this is a recurrence of #27.
  - Seven CSV `createReadStream(...).pipe(csv())` sites never listened for the
    source stream's `'error'`. A missing or unreadable file therefore crashed
    the process with an uncaught exception.
  - Each site now has `.on('error', reject)`, and there are eight new tests.
- **#1176 filed and CLOSED, `028dcc72`**: importPatients' JSON missing-file
  test had been passing on a `db.collection` TypeError. It now asserts
  `ENOENT`.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1174** is still awaiting Dennis's (a)/(b) call
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1174#issuecomment-5804273623)).
  Nothing changed this sitting.
- #1163, #1149 and #1145 are unchanged, and each still needs a design
  direction.
- The rest of the open set is mostly `question` / decision-record issues.
  #1155 (shell-script tests) and #1098 (a `startServer()` boot test) are the
  enhancement items workable without a direction. Neither was started.

## Docker and the machine

**The test stack is LEFT RUNNING:** twelve services, all healthy, and brought
up about 25 minutes into this sitting.
- The backend and worker images predate `851e4884` and `ab385246`. **Rebuild
  before any e2e that touches import paths.**
- It was not used this sitting. The reference-data bootstrap chain has not been
  run against it, so it is not ready for a full-suite gate.

Tear the stack down at the sitting's end.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Run multi-file e2e locally with `--workers=1` until #1174 is decided.**
- `import.service.js` and `result-worker.js` use CRLF line endings, while the
  other import services use LF. A scripted edit must detect endings per file
  and write each file back in its own style.

## Recommended next

**None queued by name.** #1174 needs Dennis's call first.
