import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVISOR_PHILOSOPHY_INVESTORS,
  findPhilosophyPrinciple,
  loadAdvisorPhilosophy,
} from "./philosophy";

test("philosophy v1 identifies every required investor", () => {
  const philosophy = loadAdvisorPhilosophy("v1");

  assert.equal(philosophy.version, "v1");
  for (const investor of ADVISOR_PHILOSOPHY_INVESTORS) {
    assert.ok(
      philosophy.principles.some(principle => principle.investor === investor),
      `philosophy v1 is missing ${investor}`,
    );
  }
});

test("philosophy v1 publishes its research boundaries", () => {
  const philosophy = loadAdvisorPhilosophy("v1");

  assert.ok(philosophy.limitations.length >= 3);
  const boundaries = philosophy.limitations.join(" ").toLowerCase();
  for (const boundary of ["suitability", "custody", "tax", "guarantee"]) {
    assert.ok(boundaries.includes(boundary), `philosophy v1 omits the ${boundary} boundary`);
  }
});

test("principles expose stable, unique, citable identifiers", () => {
  const philosophy = loadAdvisorPhilosophy("v1");
  const identifiers = philosophy.principles.map(principle => principle.id);

  assert.equal(new Set(identifiers).size, identifiers.length);
  for (const principle of philosophy.principles) {
    assert.match(principle.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(principle.title.length > 0);
    assert.ok(principle.summary.length > 0);
  }

  const referenced = findPhilosophyPrinciple(philosophy, identifiers[0]);
  assert.equal(referenced?.id, identifiers[0]);
  assert.equal(findPhilosophyPrinciple(philosophy, "not-a-principle"), undefined);
});

test("rejects unpublished and traversing philosophy versions", () => {
  for (const version of ["", "v0", "V1", "1", "v1.md", "../v1", "v1/../../etc/passwd"]) {
    assert.throws(() => loadAdvisorPhilosophy(version), /philosophy version/i, version);
  }
  assert.throws(() => loadAdvisorPhilosophy("v9"), /is not published/i);
});
