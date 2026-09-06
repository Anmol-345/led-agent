#!/usr/bin/env node
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const ENV = join(ROOT, ".env");

/** Anvil & Hardhat node default account #0 (same mnemonic-derived key). */
const LOCAL_DEFAULT_ACCT0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function loadDotEnv() {
  const out = {};
  if (!existsSync(ENV)) return out;
  let raw;
  try {
    raw = readFileSync(ENV, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/**
 * Send 100 ETH from local dev account #0 to each unique address (deployer + agent).
 * @param {string[]} addresses
 * @param {string} [rpcUrl]
 */
export async function fundLocalAddresses(addresses, rpcUrl) {
  const rpc =
    (rpcUrl && String(rpcUrl).trim()) ||
    process.env.RPC_URL?.trim() ||
    process.env.LOCALHOST_RPC_URL?.trim() ||
    "http://127.0.0.1:8545";

  const seen = new Set();
  const list = [];
  for (const a of addresses) {
    const x = typeof a === "string" ? a.trim() : "";
    if (!x.startsWith("0x")) continue;
    const low = x.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    list.push(x);
  }

  if (list.length === 0) {
    return { ok: true, funded: [], rpc };
  }

  const signer = privateKeyToAccount(LOCAL_DEFAULT_ACCT0);
  const client = createWalletClient({
    account: signer,
    chain: hardhat,
    transport: http(rpc),
  });

  const funded = [];
  try {
    for (const to of list) {
      const hash = await client.sendTransaction({
        to,
        value: parseEther("100"),
      });
      funded.push({ to, hash });
    }
    return { ok: true, funded, rpc };
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    let cause = "";
    if (e instanceof Error && e.cause) {
      cause =
        e.cause instanceof Error ? e.cause.message : String(e.cause);
    }
    const combined = message + " " + cause;
    if (
      /fetch failed|ECONNREFUSED|connect ECONNREFUSED|network error/i.test(
        combined,
      )
    ) {
      message +=
        " — nothing is listening at " +
        rpc +
        ". Start the local chain first (e.g. just chain), then run just fund.";
    }
    return {
      ok: false,
      funded,
      rpc,
      message,
    };
  }
}

function loadSwarmAddressesFromPublic(root) {
  const paths = [
    join(root, "packages/nextjs/public/agents.json"),
    join(root, "packages/vite/public/agents.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : j.agents;
      if (!Array.isArray(arr)) continue;
      const out = [];
      for (const row of arr) {
        const a =
          row && typeof row.address === "string" ? row.address.trim() : "";
        if (/^0x[a-fA-F0-9]{40}$/i.test(a)) out.push(a);
      }
      if (out.length) return out;
    } catch {
      /* ignore */
    }
  }
  return [];
}

async function cliMain() {
  const fileEnv = loadDotEnv();
  const deployer =
    process.env.DEPLOYER_ADDRESS?.trim() || fileEnv.DEPLOYER_ADDRESS?.trim();
  const agent =
    process.env.AGENT_ADDRESS?.trim() || fileEnv.AGENT_ADDRESS?.trim();

  if (!deployer?.startsWith("0x")) {
    console.error(
      "DEPLOYER_ADDRESS missing. Set it in .env or run: just generate",
    );
    process.exit(1);
  }

  const rpc =
    process.env.RPC_URL?.trim() ||
    process.env.LOCALHOST_RPC_URL?.trim() ||
    fileEnv.RPC_URL ||
    "http://127.0.0.1:8545";

  const swarmFromFile = loadSwarmAddressesFromPublic(ROOT);
  const targets = [deployer, agent, ...swarmFromFile].filter((a) =>
    a?.startsWith("0x"),
  );
  const unique = [];
  const s = new Set();
  for (const a of targets) {
    const low = a.toLowerCase();
    if (s.has(low)) continue;
    s.add(low);
    unique.push(a);
  }

  console.log("\n  Funding from local account #0 via " + rpc);
  for (const addr of unique) {
    console.log("    → " + addr);
  }

  const result = await fundLocalAddresses(unique, rpc);
  if (!result.ok) {
    console.error("\n  Failed:", result.message || "unknown");
    console.error(
      "  Is the chain running? (just chain) Same RPC? Override with RPC_URL in .env\n",
    );
    process.exit(1);
  }
  for (const f of result.funded) {
    console.log("  Tx " + f.to.slice(0, 10) + "…: " + f.hash);
  }
  console.log("  Done — run: just deploy\n");
}

const entry = process.argv[1] && resolve(process.argv[1]);
const isMain = entry && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
