import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CREDIT_SESSION_COOKIE, readBoundedJson } from "./api";

test("credit HTTP security boundaries", async t => {
  await t.test("rejects malformed, non-object, and oversized JSON bodies", async () => {
    const malformed = new Request("https://app.leg.investments/api/credits/challenge", {
      method: "POST",
      body: "{",
    });
    const array = new Request("https://app.leg.investments/api/credits/challenge", {
      method: "POST",
      body: "[]",
    });
    const oversized = new Request("https://app.leg.investments/api/credits/challenge", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(8_192) }),
    });

    assert.equal(await readBoundedJson(malformed), null);
    assert.equal(await readBoundedJson(array), null);
    assert.equal(await readBoundedJson(oversized), null);
  });

  await t.test("cancels an oversized chunked body without Content-Length", async () => {
    let pulls = 0;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 64) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(4_096));
      },
      cancel() {
        canceled = true;
      },
    });
    const request = new Request(
      "https://app.leg.investments/api/credits/challenge",
      { method: "POST" },
    );
    Object.defineProperty(request, "body", { value: stream });

    assert.equal(request.headers.get("content-length"), null);
    assert.equal(await readBoundedJson(request), null);
    assert.equal(canceled, true);
    assert.ok(pulls < 64);
  });

  await t.test("uses cookie-only account identity and never migrates from a request", () => {
    const accountRoute = readFileSync(
      fileURLToPath(new URL("../../app/api/credits/account/route.ts", import.meta.url)),
      "utf8",
    );
    const challengeRoute = readFileSync(
      fileURLToPath(new URL("../../app/api/credits/challenge/route.ts", import.meta.url)),
      "utf8",
    );
    const sessionRoute = readFileSync(
      fileURLToPath(new URL("../../app/api/credits/session/route.ts", import.meta.url)),
      "utf8",
    );

    assert.equal(accountRoute.includes('headers.get("authorization")'), false);
    assert.equal(accountRoute.includes("Bearer"), false);
    assert.ok(accountRoute.includes("cookies.get(CREDIT_SESSION_COOKIE)"));
    assert.ok(accountRoute.includes("new BaseVaultClient"));
    assert.ok(accountRoute.includes("new VaultIndexer"));
    assert.ok(accountRoute.includes("authorizationSnapshotProvider"));
    assert.ok(sessionRoute.includes("cookies.get(CREDIT_SESSION_COOKIE)"));
    assert.equal(CREDIT_SESSION_COOKIE, "__Host-leg_credit_session");
    assert.equal(accountRoute.includes("new CreditLedgerService({ prisma, config })"), false);
    assert.equal(challengeRoute.includes("migrateCreditDatabase"), false);
    assert.equal(sessionRoute.includes("migrateCreditDatabase"), false);
    assert.equal(accountRoute.includes("migrateCreditDatabase"), false);
    assert.ok(sessionRoute.includes("export async function DELETE"));
  });
});
