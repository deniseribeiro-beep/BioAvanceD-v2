/**
 * #746: e2e fixtures that submit a participant document can't use a fixed
 * CPF. `patient.service.js` enforces RF005/RNF007 identity uniqueness
 * (`identityDocument ... já cadastrado no sistema.` → 409), and the
 * `mongodb-test-data` volume persists across runs, so any constant value
 * conflicts on every run after the first. Generate a fresh, checksum-valid
 * one per call instead.
 *
 * The check digits mirror `api/backend/src/utils/security.js#validateCPF`
 * (weights 10..2 over the first 9 digits, then 11..2 over the first 10;
 * a remainder < 2 yields 0). A purely numeric document is always routed
 * through that CPF check, never the passport branch, regardless of digit
 * count.
 */

let counter = 0;

function checkDigit(digits: number[]): number {
  const weightStart = digits.length + 1;
  const sum = digits.reduce((acc, digit, i) => acc + digit * (weightStart - i), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Returns an 11-digit, checksum-valid CPF that is unique per call within a
 * run and (via `Date.now()`) across runs on a shared volume.
 */
export function generateValidCpf(): string {
  // 9 base digits from the clock plus a per-call counter, so two calls in
  // the same millisecond still differ.
  const seed = `${Date.now()}${counter++}`.slice(-9).padStart(9, '1');
  const base = seed.split('').map(Number);

  // `validateCPF` rejects all-same-digit values (`11111111111` etc.) as
  // sequential, which the padding above could otherwise produce.
  if (base.every((d) => d === base[0])) {
    base[0] = (base[0] + 1) % 10;
  }

  const first = checkDigit(base);
  const second = checkDigit([...base, first]);
  return `${base.join('')}${first}${second}`;
}
