import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVISOR_DECIMAL_SCALE,
  divideDecimal,
  formatAdvisorDecimal,
  multiplyDecimal,
  parseAdvisorDecimal,
  parseAdvisorNumber,
  squareRootDecimal,
} from "./decimal";

test("parses and formats fixed-point decimals without floating point drift", () => {
  assert.equal(ADVISOR_DECIMAL_SCALE, 8);
  assert.equal(parseAdvisorDecimal("4.20"), 420_000_000n);
  assert.equal(parseAdvisorDecimal("-18.4"), -1_840_000_000n);
  assert.equal(parseAdvisorDecimal("0"), 0n);
  assert.equal(parseAdvisorDecimal("1234567890123"), 123_456_789_012_300_000_000n);
  // Excess precision truncates rather than rounding, so the same input always gives the same value.
  assert.equal(parseAdvisorDecimal("0.123456789"), 12_345_678n);

  assert.equal(formatAdvisorDecimal(420_000_000n), "4.2");
  assert.equal(formatAdvisorDecimal(-1_840_000_000n), "-18.4");
  assert.equal(formatAdvisorDecimal(0n), "0");
  assert.equal(formatAdvisorDecimal(12_345_678n), "0.12345678");
});

test("rejects anything that is not an exact decimal literal", () => {
  for (const invalid of ["", " 1", "1 ", "1e5", "0x10", "1.2.3", "abc", "+1", "1,5", ".5", "5.", "NaN"]) {
    assert.equal(parseAdvisorDecimal(invalid), null, invalid);
  }
});

test("parses provider numbers and refuses unrepresentable ones", () => {
  assert.equal(parseAdvisorNumber(4.2), 420_000_000n);
  assert.equal(parseAdvisorNumber(0), 0n);
  assert.equal(parseAdvisorNumber(-3.5), -350_000_000n);
  assert.equal(parseAdvisorNumber(1_234_567_890_123), 123_456_789_012_300_000_000n);

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21]) {
    assert.equal(parseAdvisorNumber(invalid), null, `${invalid}`);
  }
});

test("multiplies, divides, and roots deterministically", () => {
  const eps = parseAdvisorDecimal("4.20");
  const bookValue = parseAdvisorDecimal("18.40");
  assert.ok(eps !== null && bookValue !== null);

  assert.equal(multiplyDecimal(eps, bookValue), parseAdvisorDecimal("77.28"));
  assert.equal(divideDecimal(parseAdvisorDecimal("10")!, parseAdvisorDecimal("4")!), parseAdvisorDecimal("2.5"));
  assert.equal(squareRootDecimal(parseAdvisorDecimal("16")!), parseAdvisorDecimal("4"));
  assert.equal(squareRootDecimal(parseAdvisorDecimal("2")!), 141_421_356n);

  // The Graham number for these inputs: sqrt(22.5 * 4.20 * 18.40).
  const product = multiplyDecimal(multiplyDecimal(parseAdvisorDecimal("22.5")!, eps), bookValue);
  const graham = squareRootDecimal(product);
  assert.equal(formatAdvisorDecimal(product), "1738.8");
  assert.equal(formatAdvisorDecimal(graham!), "41.69892084");
  assert.equal(graham, squareRootDecimal(product), "identical inputs give an identical result");
});

test("refuses undefined arithmetic instead of substituting a value", () => {
  assert.equal(divideDecimal(parseAdvisorDecimal("10")!, 0n), null);
  assert.equal(squareRootDecimal(parseAdvisorDecimal("-1")!), null);
  assert.equal(squareRootDecimal(0n), 0n);
});
