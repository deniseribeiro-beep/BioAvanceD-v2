# HANDOFF

**Written 2026-09-23, forty-sixth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was "read handoff,
pick next group of issues, Docker is on". #1174 still had no reply, so the
sitting took the two enhancement items the last note named as workable without
a direction (#1098, #1155), plus the bug #1155's audit turned up (#1177).

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`67603647`.

## What shipped

- **#1098 CLOSED, `b3156ce0`**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1098#issuecomment-5804681339)):
  `tests/unit/server.startServer.1098.test.js` is the first test to execute
  `startServer()`. It pins #972/#1097, #1085, #1154 and #977. Seven defect
  probes against `server.js` all went red.
- **#1155 CLOSED, `ef6e3716`**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1155#issuecomment-5804681764)):
  `tests/architecture/env-generator-behaviour.arch.test.js` covers the
  generator's overwrite guard, key mint/reuse, registry and `--upgrade`
  behaviour.
  - It runs sandboxed copies of the script, so the repo's real audit key is
    never touched.
  - `infra/tsa/entrypoint.sh` is deliberately uncovered. Its paths are all
    hardcoded container paths, and the comment gives the reasoning.
- **#1177 filed and CLOSED, `67603647`**: the witness entrypoint guarded on a
  literal path while writing to `WITNESS_PRIVATE_KEY_PEM_FILE`.
  - Latent only: both compose files set the default.
  - Fixed, reproduced and verified in a throwaway container, and pinned by
    `tests/architecture/witness-entrypoint.arch.test.js`.

`npm run test:architecture` passed 139 of 139 before #1177's file was added.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1174** is still awaiting Dennis's (a)/(b) call
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1174#issuecomment-5804273623)).
- #1163, #1149 and #1145 are unchanged, and each still needs a design
  direction.
- With #1098 and #1155 done, the open set has **no enhancement item left that
  was named as workable without a direction.** The rest is mostly `question`
  / decision-record issues.

## Docker and the machine

**The test stack is LEFT RUNNING:** twelve services, inherited from the last
sitting and unused this one, apart from `docker run --rm` probes of the
witness test image.
- The backend and worker images predate `851e4884` and `ab385246`. **Rebuild
  before any e2e that touches import paths.**
- The reference-data bootstrap chain has not been run against it.

Tear the stack down at the sitting's end.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Run multi-file e2e locally with `--workers=1` until #1174 is decided.**
- `server.js`, `import.service.js` and `result-worker.js` use CRLF line
  endings. A scripted edit must detect endings per file.
- The generator and witness architecture tests spawn `bash`/`sh` +
  `openssl` + `python3` + `node`. They take about 40 s together, the bulk of
  the architecture suite's runtime.

## Recommended next

**None queued by name.** #1174 needs Dennis's call first.
