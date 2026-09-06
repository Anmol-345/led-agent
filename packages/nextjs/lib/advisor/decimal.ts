/**
 * Fixed-point decimals for advisor financial values.
 *
 * Every financial value the advisor normalizes, calculates, or cites is a bigint scaled by
 * 10^ADVISOR_DECIMAL_SCALE. Binary floating point is never used, so the same inputs and formula
 * version always produce the same result. Excess precision truncates toward zero rather than
 * rounding, which keeps the operation associative-free but exactly reproducible.
 */

export const ADVISOR_DECIMAL_SCALE = 8;

const SCALE_FACTOR = 10n ** BigInt(ADVISOR_DECIMAL_SCALE);
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
// Above 1e21 JavaScript stringifies with an exponent, which is not an exact decimal literal.
const MAXIMUM_PROVIDER_MAGNITUDE = 1e21;

export function parseAdvisorDecimal(text: string): bigint | null {
  if (!DECIMAL_PATTERN.test(text)) return null;

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const truncated = fraction.slice(0, ADVISOR_DECIMAL_SCALE).padEnd(ADVISOR_DECIMAL_SCALE, "0");
  const units = BigInt(`${whole}${truncated}`);
  return negative ? -units : units;
}

/** Normalizes a provider-supplied JSON number, refusing anything not exactly representable. */
export function parseAdvisorNumber(value: number): bigint | null {
  if (!Number.isFinite(value) || Math.abs(value) >= MAXIMUM_PROVIDER_MAGNITUDE) return null;
  return parseAdvisorDecimal(String(value));
}

export function formatAdvisorDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE_FACTOR;
  const fraction = (magnitude % SCALE_FACTOR)
    .toString()
    .padStart(ADVISOR_DECIMAL_SCALE, "0")
    .replace(/0+$/, "");
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

export function multiplyDecimal(left: bigint, right: bigint): bigint {
  return (left * right) / SCALE_FACTOR;
}

/** Returns null for a zero denominator so a caller reports unavailable rather than substituting. */
export function divideDecimal(numerator: bigint, denominator: bigint): bigint | null {
  if (denominator === 0n) return null;
  return (numerator * SCALE_FACTOR) / denominator;
}

/** Integer square root of a scaled decimal; null for a negative operand. */
export function squareRootDecimal(value: bigint): bigint | null {
  if (value < 0n) return null;
  if (value === 0n) return 0n;

  const scaled = value * SCALE_FACTOR;
  let guess = scaled;
  let next = (guess + 1n) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + scaled / guess) / 2n;
  }
  return guess;
}
