// Shared comment stripper for the architecture guards (#945).
//
// WHY THIS EXISTS. Several guards in this directory assert "this file does
// not contain substring X" by reading the raw file and calling `includes()`.
// Because those checks never stripped comments, a *comment* naming the
// forbidden token failed the guard exactly as an import would. That is a
// false positive that reads as a real architectural violation, and it
// silently shapes what comments the guarded files are allowed to say —
// `neo4j-boundary` forbids the literals `patientID`/`sampleID`, which are
// precisely the legacy aliases a comment in that file most wants to explain.
// Hit live while resolving #902: adding a comment to `app.js` that cited a
// seed script by filename took `npm run test:architecture` from 110/110 to
// 109/110.
//
// WHY IT IS THIS IMPLEMENTATION AND NOT THE OTHER ONE. Before #945 this
// function existed twice, independently, in `env-declarations.arch.test.js`
// and `request-body-boundary.arch.test.js`, and the two had diverged: the
// latter was a "minimal form" that did not understand regex literals. That
// is not a cosmetic difference. Given
//
//     const rx = /^https?:\/\//; const bad = neo4jDriver.session;
//
// the minimal form reads the escaped slash plus the closing delimiter as a
// `//` comment opener and blanks the remainder of the line, so `includes()`
// no longer sees `neo4jDriver.session` at all. A guard that silently sees
// *less* is worse than one that is noisy, so the surviving implementation is
// the string- and regex-aware one, and `request-body-boundary` gains that
// robustness by adopting it.
//
// Comments are blanked rather than deleted so byte offsets and line
// structure survive; `request-body-boundary` reports line numbers off the
// stripped content and depends on that.
//
// `REGEX_ALLOWED_AFTER` is the standard "can a `/` start a regex here"
// heuristic: at the start of input, after an operator or opening bracket, or
// after a keyword that must be followed by an expression. A `/` in any other
// position is division.
const REGEX_ALLOWED_AFTER =
  /(?:^|[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await))\s*$/;

function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && d === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') {
          out += source[i];
          i += 1;
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        out += source[i];
        i += 1;
      }
      if (i < n) {
        out += source[i];
        i += 1;
      }
      continue;
    }

    if (c === '/' && REGEX_ALLOWED_AFTER.test(out.slice(-16))) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const ch = source[i];
        out += ch;
        i += 1;
        if (ch === '\\') {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

// Convenience for the "read a file and ask whether it really contains X"
// shape that most of the guards in this directory are. Keeping it here means
// a guard adopting comment-awareness is a one-line change at the call site
// rather than a read/strip/includes dance repeated per guard.
function readStripped(fs, file) {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

module.exports = { stripComments, readStripped, REGEX_ALLOWED_AFTER };
