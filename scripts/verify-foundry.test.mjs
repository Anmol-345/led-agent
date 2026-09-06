import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = fileURLToPath(new URL("./verify-foundry.mjs", import.meta.url));

for (const scenario of [
  {
    network: "base",
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    network: "baseSepolia",
    chainId: 84532,
    usdc: "0x5555555555555555555555555555555555555555",
  },
]) {
  test(`verifies AgentWallet and CustomerCreditVault on ${scenario.network}`, () => {
    const root = mkdtempSync(join(tmpdir(), "leg-verify-foundry-"));
    const calls = join(root, "calls.txt");
    const bin = join(root, "bin");
    const broadcast = join(
      root,
      "packages",
      "foundry",
      "broadcast",
      "Deploy.s.sol",
      String(scenario.chainId),
    );
    mkdirSync(bin, { recursive: true });
    mkdirSync(broadcast, { recursive: true });
    writeFileSync(
      join(broadcast, "run-latest.json"),
      JSON.stringify({
        transactions: [
          {
            transactionType: "CREATE",
            contractName: "AgentWallet",
            contractAddress: "0x1111111111111111111111111111111111111111",
          },
          {
            transactionType: "CREATE",
            contractName: "CustomerCreditVault",
            contractAddress: "0x2222222222222222222222222222222222222222",
          },
        ],
      }),
    );
    for (const command of ["cast", "forge"]) {
      const executable = join(bin, command);
      writeFileSync(
        executable,
        command === "cast"
          ? '#!/bin/sh\nprintf "cast %s\\n" "$*" >> "$VERIFY_CALLS"\nprintf "0x1234\\n"\n'
          : '#!/bin/sh\nprintf "forge %s\\n" "$*" >> "$VERIFY_CALLS"\n',
      );
      chmodSync(executable, 0o755);
    }

    try {
      const result = spawnSync(process.execPath, [verifier, scenario.network], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          VERIFY_CALLS: calls,
          BASESCAN_API_KEY: "test-key",
          AGENT_ADDRESS: "0x3333333333333333333333333333333333333333",
          CREDIT_REHEARSAL_USDC_ADDRESS: scenario.usdc,
          CREDIT_ADMIN_ADDRESS: "0x6666666666666666666666666666666666666666",
          CREDIT_BILLING_ADDRESS: "0x7777777777777777777777777777777777777777",
          CREDIT_TREASURY_ADDRESS: "0x8888888888888888888888888888888888888888",
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const recorded = readFileSync(calls, "utf8");
      assert.match(recorded, /src\/AgentWallet\.sol:AgentWallet/);
      assert.match(
        recorded,
        /src\/CustomerCreditVault\.sol:CustomerCreditVault/,
      );
      assert.match(recorded, new RegExp(scenario.usdc, "i"));
      assert.match(
        recorded,
        /constructor\(address,address,address,address\).*0x6666.*0x7777.*0x8888/i,
      );
      assert.equal(recorded.match(/--watch/g)?.length, 2);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
}

test("fails when a Base deployment omits the expected CustomerCreditVault", () => {
  const root = mkdtempSync(join(tmpdir(), "leg-verify-foundry-missing-vault-"));
  const bin = join(root, "bin");
  const broadcast = join(
    root,
    "packages",
    "foundry",
    "broadcast",
    "Deploy.s.sol",
    "8453",
  );
  mkdirSync(bin, { recursive: true });
  mkdirSync(broadcast, { recursive: true });
  writeFileSync(
    join(broadcast, "run-latest.json"),
    JSON.stringify({
      transactions: [
        {
          transactionType: "CREATE",
          contractName: "AgentWallet",
          contractAddress: "0x1111111111111111111111111111111111111111",
        },
      ],
    }),
  );
  for (const command of ["cast", "forge"]) {
    const executable = join(bin, command);
    writeFileSync(
      executable,
      command === "cast"
        ? '#!/bin/sh\nprintf "0x1234\\n"\n'
        : "#!/bin/sh\nexit 0\n",
    );
    chmodSync(executable, 0o755);
  }

  try {
    const result = spawnSync(process.execPath, [verifier, "base"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        BASESCAN_API_KEY: "test-key",
        AGENT_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected CustomerCreditVault/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
