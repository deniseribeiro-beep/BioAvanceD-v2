/**
 * #1212: escape a caller's search term so `new RegExp(...)` matches it
 * literally. Unescaped, '(' threw a SyntaxError inside the handler and '.'
 * or '*' widened the match -- and the compiled pattern is sent to MongoDB as
 * a $regex, so a caller could run any pattern there.
 *
 * Same character class as the local copies in phone-codes.routes.js,
 * reports.routes.js and terminologies.routes.js.
 */
function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
