// Shared RBAC gate-site extractor for the architecture guards (#1342, from
// #921).
//
// Every `requirePermission(...)` and `requireRole(...)` call in the two route
// directories, attributed to the `router.<verb>(` registration it sits in
// (or to the `router.use(` it gates), with the route path that registration
// names. rbac-actions.arch.test.js reads the requirePermission sites; a
// guard on which sites a test pins reads both kinds.
//
// It reads COMMENT-STRIPPED source (strip-comments.js). Before #1342 the
// requirePermission sweep ran over raw text, so a gate spelled out in a
// comment counted as a call site. Blanking keeps offsets and line numbers,
// so a reported `file:line` is the source's.
//
// Multi-line registrations are the normal shape here (sample.routes.js,
// import.routes.js), so a gate is attributed by offset to the nearest
// preceding `router.*` construct, not by line.

const fs = require('fs');
const path = require('path');
const { readStripped } = require('./strip-comments');

const BACKEND_SRC = path.resolve(__dirname, '../../../src');
const ROUTE_DIRS = [
  path.resolve(BACKEND_SRC, 'routes'),
  path.resolve(BACKEND_SRC, 'interface/routes'),
];

const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/gi;
const ROUTER_USE = /\brouter\.use\s*\(/g;
const GATE = /\b(requirePermission|requireRole)\s*\(/g;
const PERMISSION_LITERAL = /^\s*(['"])([^'"]+)\1\s*(?:,\s*(['"])([^'"]+)\3\s*)?$/;
const ROLE_LITERALS = /^\s*\d+(?:\s*,\s*\d+)*\s*$/;

function routeFiles() {
  const files = [];
  for (const dir of ROUTE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.js$/.test(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function relative(file) {
  return path.relative(BACKEND_SRC, file).split(path.sep).join('/');
}

// The text between a call's opening parenthesis and its matching close.
function argsAt(content, openIndex) {
  let depth = 1;
  for (let i = openIndex + 1; i < content.length; i += 1) {
    if (content[i] === '(') depth += 1;
    else if (content[i] === ')') {
      depth -= 1;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Every gate site in one file's comment-stripped source. */
function gateSitesIn(content, file) {
  const starts = [...content.matchAll(ROUTE_START)].map((m) => ({
    index: m.index,
    method: m[1].toUpperCase(),
    routePath: m[3] === undefined ? null : m[3],
  }));
  const useStarts = [...content.matchAll(ROUTER_USE)].map((m) => m.index);

  const registrationAt = (index) => {
    let current = null;
    for (const start of starts) {
      if (start.index <= index) current = start;
      else break;
    }
    return current;
  };
  const isRouterUse = (index) => {
    const lastUse = Math.max(...useStarts.filter((i) => i <= index), -1);
    const registration = registrationAt(index);
    return lastUse > (registration ? registration.index : -1);
  };
  const verbsAfter = (index) => [...new Set(starts.filter((s) => s.index > index).map((s) => s.method))];

  const sites = [];
  for (const match of content.matchAll(GATE)) {
    const kind = match[1];
    const openIndex = match.index + match[0].length - 1;
    const rawArgs = argsAt(content, openIndex);
    const line = content.slice(0, match.index).split('\n').length;
    const routerLevel = isRouterUse(match.index);
    const registration = routerLevel ? null : registrationAt(match.index);

    const site = {
      file: relative(file),
      line,
      kind,
      rawArgs,
      routerLevel,
      method: registration ? registration.method : null,
      routePath: registration ? registration.routePath : null,
      coveredMethods: routerLevel ? verbsAfter(match.index) : null,
    };

    if (kind === 'requirePermission') {
      const literal = rawArgs === null ? null : rawArgs.match(PERMISSION_LITERAL);
      site.code = literal ? literal[2] : null;
      site.explicitAction = literal ? literal[4] || null : null;
    } else {
      site.roles = rawArgs !== null && ROLE_LITERALS.test(rawArgs)
        ? rawArgs.split(',').map((r) => Number(r.trim()))
        : null;
    }
    sites.push(site);
  }
  return sites;
}

/** Every gate site across both route directories. */
function gateSites() {
  return routeFiles().flatMap((file) => gateSitesIn(readStripped(fs, file), file));
}

module.exports = { BACKEND_SRC, ROUTE_DIRS, routeFiles, relative, argsAt, gateSitesIn, gateSites };
