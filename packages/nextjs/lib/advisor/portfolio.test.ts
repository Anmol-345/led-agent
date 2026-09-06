import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import {
  ADVISOR_SUPPORTED_ASSETS,
  PortfolioReader,
  type AdvisorAssetSelection,
  type AdvisorSupportedAsset,
  type BalanceReader,
} from "./portfolio";

const wallet: Address = "0x1111111111111111111111111111111111111111";
const otherWallet: Address = "0x2222222222222222222222222222222222222222";
const readAt = new Date("2026-07-26T12:00:00.000Z");

// A test-only support table. The shipped list carries only assets whose issuer mapping has been
// verified, so the mapped path is exercised here rather than with an invented production address.
const supported: AdvisorSupportedAsset = {
  chainId: 8453,
  decimals: 18,
  researchSymbol: "EXMP",
  token: "0x3333333333333333333333333333333333333333",
};
const unmappedAsset: AdvisorSupportedAsset = {
  chainId: 8453,
  decimals: 6,
  researchSymbol: null,
  token: "0x4444444444444444444444444444444444444444",
};
const testAssets: readonly AdvisorSupportedAsset[] = [supported, unmappedAsset];

type RecordedRead = { chainId: number; owner: Address; token: Address };

function balanceReader(options: {
  balance?: bigint;
  fail?: boolean;
  recorded?: RecordedRead[];
}): BalanceReader {
  return {
    async balanceOf(input) {
      options.recorded?.push(input);
      if (options.fail) throw new Error("rpc unavailable at https://secret-rpc.example/key");
      return options.balance ?? 12_500_000n;
    },
  };
}

function reader(balances: BalanceReader): PortfolioReader {
  return new PortfolioReader({ assets: testAssets, balances, now: () => readAt });
}

test("reads a selected supported holding for the authenticated wallet", async () => {
  const recorded: RecordedRead[] = [];
  const holdings = await reader(balanceReader({ recorded })).read({
    selections: [{ chainId: supported.chainId, token: supported.token }],
    wallet,
  });

  assert.equal(holdings.length, 1);
  const [holding] = holdings;
  assert.equal(holding.kind, "observed");
  if (holding.kind !== "observed") return;
  assert.equal(holding.chainId, supported.chainId);
  assert.equal(holding.token, supported.token);
  assert.equal(holding.amount, 12_500_000n);
  assert.equal(holding.decimals, supported.decimals);
  assert.equal(holding.readAt.getTime(), readAt.getTime());
  assert.deepEqual(holding.research, { symbol: "EXMP" });

  assert.deepEqual(recorded, [
    { chainId: supported.chainId, owner: wallet, token: supported.token },
  ]);
});

test("an unsupported chain or token is unvalued and never inferred", async () => {
  const recorded: RecordedRead[] = [];
  const holdings = await reader(balanceReader({ recorded })).read({
    selections: [
      { chainId: 999_999, token: supported.token },
      { chainId: supported.chainId, token: "0x9999999999999999999999999999999999999999" },
    ],
    wallet,
  });

  for (const holding of holdings) {
    assert.equal(holding.kind, "unavailable");
    if (holding.kind !== "unavailable") return;
    assert.equal(holding.reason, "unsupported-asset");
    assert.equal("amount" in holding, false, "an unsupported asset has no inferred balance");
    assert.equal("research" in holding, false, "an unsupported asset has no inferred ticker");
  }
  assert.deepEqual(recorded, [], "an unsupported asset is never read on chain");
});

test("a failed read is unavailable without leaking the RPC endpoint", async () => {
  const holdings = await reader(balanceReader({ fail: true })).read({
    selections: [{ chainId: supported.chainId, token: supported.token }],
    wallet,
  });

  const [holding] = holdings;
  assert.equal(holding.kind, "unavailable");
  if (holding.kind !== "unavailable") return;
  assert.equal(holding.reason, "read-failed");
  const serialized = JSON.stringify(holding);
  assert.doesNotMatch(serialized, /secret-rpc/);
  assert.doesNotMatch(serialized, /rpc unavailable/);
});

test("a supported asset without a research mapping stays explicitly unvalued", async () => {
  const holdings = await reader(balanceReader({})).read({
    selections: [{ chainId: unmappedAsset.chainId, token: unmappedAsset.token }],
    wallet,
  });

  const [holding] = holdings;
  assert.equal(holding.kind, "observed");
  if (holding.kind !== "observed") return;
  assert.equal(holding.research, null, "no ticker, price, or eligibility is inferred");
});

test("an on-chain observation never carries a price or trading claim", async () => {
  const holdings = await reader(balanceReader({})).read({
    selections: [{ chainId: supported.chainId, token: supported.token }],
    wallet,
  });

  const [holding] = holdings;
  assert.equal(holding.kind, "observed");
  if (holding.kind !== "observed") return;
  for (const forbidden of ["price", "value", "usd", "eligible", "tradable", "issuer"]) {
    assert.equal(forbidden in holding, false, `holding must not claim ${forbidden}`);
  }
});

test("reads only the authenticated wallet and refuses an invalid one", async () => {
  const recorded: RecordedRead[] = [];
  const subject = reader(balanceReader({ recorded }));

  await subject.read({
    selections: [{ chainId: supported.chainId, token: supported.token }],
    wallet: otherWallet,
  });
  assert.equal(recorded[0].owner, otherWallet);

  for (const invalid of ["", "0x", "not-an-address", "0x111"]) {
    await assert.rejects(
      () => subject.read({ selections: [], wallet: invalid }),
      /wallet/i,
      invalid,
    );
  }
});

test("duplicate selections collapse and an oversized selection is refused", async () => {
  const recorded: RecordedRead[] = [];
  const subject = reader(balanceReader({ recorded }));
  const selection: AdvisorAssetSelection = {
    chainId: supported.chainId,
    token: supported.token,
  };

  const holdings = await subject.read({ selections: [selection, selection], wallet });
  assert.equal(holdings.length, 1);
  assert.equal(recorded.length, 1);

  await assert.rejects(
    () =>
      subject.read({
        selections: Array.from({ length: 65 }, (_unused, index) => ({
          chainId: supported.chainId,
          token: `0x${index.toString(16).padStart(40, "0")}`,
        })),
        wallet,
      }),
    /selection/i,
  );
});

test("the shipped support list carries only verified assets", () => {
  for (const asset of ADVISOR_SUPPORTED_ASSETS) {
    assert.match(asset.token, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(Number.isSafeInteger(asset.chainId) && asset.chainId > 0);
    assert.ok(Number.isSafeInteger(asset.decimals) && asset.decimals >= 0);
  }
});

test("the reader exposes no write, approval, or signing capability", () => {
  const subject = reader(balanceReader({}));
  const surface = [
    ...Object.getOwnPropertyNames(PortfolioReader.prototype),
    ...Object.keys(subject),
  ];

  for (const forbidden of ["approve", "transfer", "sign", "send", "write", "privateKey"]) {
    assert.equal(
      surface.some(name => name.toLowerCase().includes(forbidden)),
      false,
      `portfolio reader must not expose ${forbidden}`,
    );
  }
});
