# 2026-11-06: RNF020 C1 and C5, and RNF021 C5's Secure flag, are proven in CI outside the e2e stack

## Context

W5's done rule asks for every RF and RNF criterion to be proven by a real-backend Playwright test (#1456). Three criteria cannot be observed on the e2e stack as it runs:

- RNF020 C1 (TLS 1.2 or higher). The stack serves plain HTTP (`compose.test.yml`: the API at `http://localhost:3000`), and `scripts/gcp-access-proxy/nginx.conf` listens on 8080 without TLS. TLS is terminated by the deployment's HTTPS edge (the load balancer in front of `bioadvanced.dev`), outside this repository.
- RNF020 C5 (secrets rotatable without a code change). A rotation swaps `ENCRYPTION_KEY`/`ENCRYPTION_KEY_ID` into the `_PREVIOUS` slots and restarts the backend (`api/backend/src/config/keyRegistry.js`). The e2e job cannot restart the backend under a second key.
- RNF021 C5's `Secure` flag. The refresh cookie is `Secure` and `SameSite=Strict` only under `NODE_ENV=production` (`getRefreshCookieOptions`), and the stack runs `NODE_ENV=test` over HTTP.

## Decision

Each is proven by a check CI runs, where the property can actually be observed (decided 2026-11-06: "Can we do these tests on CI better? If so, go ahead for CI implementation"):

1. RNF020 C1: a CI workflow of its own checks the deployed HTTPS host: a TLS 1.1 handshake against `bioadvanced.dev:443` must fail and a TLS 1.2 handshake must complete. The client is told to offer TLS 1.1 at a lowered security level, so the refusal is the server's and not the client's default. It is a separate workflow so a red result points at the deployment, not at the test suite. The e2e proves the application's part: the API sends `Strict-Transport-Security` (`auth-access-security.spec.ts`, "the API sends Strict-Transport-Security").
2. RNF020 C5: the backend tests `api/backend/tests/unit/fieldEncryption.test.js` (an envelope written under the previous key decrypts after a rotation; new envelopes go under the active key; the retired slot stops decrypting) and `api/backend/tests/unit/keyRegistry.test.js`, run by CI's backend unit job (#1454). The e2e proves the hook those tests rely on: the stored MFA envelope names the deployment's key id, not the code default.
3. RNF021 C5: `Secure` and `SameSite=Strict` are proven by `api/backend/tests/integration/auth.refresh-cookie.1456.test.js` under `NODE_ENV=production`, run by CI's backend unit job (#1454); the e2e proves `HttpOnly`, `SameSite=Lax` and `Path=/api/auth` on the stack.

## Consequences

- W5's done rule counts these three criteria as proven once CI's backend unit job and the TLS workflow are green.
- A change to the cookie options, the key registry or the HSTS settings keeps these tests in step.
- When the deployment's host changes, the TLS workflow's host changes with it.
