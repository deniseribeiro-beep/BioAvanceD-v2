import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// #822: the participant-facing pages are entered by emailed URL only, are
// covered by no spec, and are reachable from no in-app link -- so a transport
// bug in them stays invisible indefinitely. These are static guards over the
// two traps that produced the original defect, in the same idiom as
// rolePermissions.test.ts's App.tsx route sweep (#816).
//
// Trap 1: a relative `/api/...` URL resolves against the *frontend* origin.
// Nothing proxies /api there in dev, test or prod (no `server.proxy` in
// vite.config.js, no `location /api` in nginx.conf), so the request falls
// through the SPA history fallback and returns index.html -- HTML with a 200,
// which axios resolves rather than rejects. Confirmed against the live test
// stack on 2026-08-27:
//   curl http://localhost:5173/api/e-consent/validate/x -> 200 text/html
//   curl http://localhost:3000/api/e-consent/validate/x -> 401 application/json
//
// Trap 2: swapping to the shared client is not sufficient on its own. Its
// request interceptor cancels any request made with no `token` in
// localStorage and redirects to /login -- so a participant following an
// emailed link, who by definition has no session, would bounce to the auth
// wall. Every participant endpoint has to be in TOKEN_OPTIONAL_ROUTES.

const PARTICIPANT_PAGES = [
  'EConsentPage.tsx',
  'EConsentImportPage.tsx',
  'ConsentTokenPage.tsx',
];

// The backend routes these pages call, all public in routes/eConsent.js
// (no `authenticate` middleware on any of them).
const PARTICIPANT_ENDPOINTS = [
  '/e-consent/validate',
  '/e-consent/update',
  '/e-consent/import/fhir/consent',
  '/e-consent/consent-tokens/validate',
  '/e-consent/consent-tokens/accept',
];

function readPage(fileName: string): string {
  return fs.readFileSync(path.resolve(__dirname, fileName), 'utf8');
}

/**
 * Comments describe the defect -- including the `/api/...` shape these pages
 * must no longer use -- so scanning raw source flags the very notes that
 * explain the fix. Strip block and line comments before looking for code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('participant-facing pages use the shared api client, not relative axios', () => {
  it.each(PARTICIPANT_PAGES)('%s imports no raw axios', (fileName) => {
    const source = readPage(fileName);

    expect(source).not.toMatch(/^import\s+axios\b/m);
    expect(source).not.toMatch(/from\s+['"]axios['"]/);
  });

  it.each(PARTICIPANT_PAGES)('%s contains no relative /api URL', (fileName) => {
    const source = stripComments(readPage(fileName));

    // Both quote styles and template literals -- the original defect used
    // backticks for the token-bearing GETs and single quotes for the POST.
    const relativeApiUrls = Array.from(source.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)).map(
      (match) => match[1]
    );

    expect(relativeApiUrls).toEqual([]);
  });
});

describe('every participant endpoint is token-optional', () => {
  // Without this, the shared client's request interceptor cancels the call and
  // calls terminateSessionAndRedirect() -- #809's auth wall, relocated from
  // ProtectedRoute into the API client.
  const apiSource = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'services', 'api.ts'),
    'utf8'
  );

  const listBody = apiSource.match(/const TOKEN_OPTIONAL_ROUTES = \[([\s\S]*?)\];/)?.[1] ?? '';

  it('finds the TOKEN_OPTIONAL_ROUTES declaration', () => {
    expect(listBody).not.toBe('');
  });

  it.each(PARTICIPANT_ENDPOINTS)('%s is listed', (endpoint) => {
    expect(listBody).toContain(`'${endpoint}'`);
  });
});

describe('participant-facing pages map a failure from the whole error, not its status', () => {
  // #1152, #1158: in a real outage there is no response. api.ts aborts at its
  // own 10s timeout while the backend answers 503 only after 30s+, so a page
  // that hands `err.response?.status` to a mapper passes `undefined` and loses
  // the "no response at all" case. The *RequestError mappers take the error;
  // their tests prove the copy, and this pins that the pages actually call them.
  it.each(PARTICIPANT_PAGES)('%s passes no response status to an error mapper', (fileName) => {
    const code = stripComments(readPage(fileName));

    expect(code).not.toMatch(/response\?\.status/);
    expect(code).toMatch(/RequestError\(err\)/);
  });
});
