import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// #1408: `/locations` redirected to `?tab=locations`, a tab the page does not
// have, so it silently fell back to `equipment`. Every redirect into the page
// must name a tab in its `validTabs` list.
describe('facility-management redirects in App.tsx', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');
  const pageSource = fs.readFileSync(path.resolve(__dirname, 'FacilityManagementPage.tsx'), 'utf8');

  const redirectTabs = Array.from(appSource.matchAll(/facility-management\?tab=(\w+)/g)).map((m) => m[1]);

  const validTabsLiteral = pageSource.match(/const validTabs: TabType\[\] = \[([^\]]+)\]/);
  const validTabs = validTabsLiteral
    ? Array.from(validTabsLiteral[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
    : [];

  it('finds every facility-management redirect in App.tsx', () => {
    // Guards the regex: a changed redirect shape would make the next case
    // vacuously green.
    expect(redirectTabs).toHaveLength(6);
    expect(validTabs.length).toBeGreaterThan(0);
  });

  it('every facility-management redirect in App.tsx names a valid tab', () => {
    expect(redirectTabs.filter((tab) => !validTabs.includes(tab))).toEqual([]);
  });
});
