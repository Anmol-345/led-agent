/**
 * Print native token balances for DEPLOYER_ADDRESS and agent on all networks in network-definitions.
 * Uses rpcOverrides from scaffold.config.ts (same rules as getActiveNetwork).
 * Run from repo root: just balances
 */
import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import type { Chain } from "viem";
import { NETWORKS, type NetworkKey } from "../network-definitions";
import { rpcOverrides } from "../scaffold.config";

function pickAddr(...keys: string[]): string | null {
  for (const key of keys) {
    const v = (process.env[key] || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/i.test(v)) return v;
  }
  return null;
}

function rpcForNetwork(key: NetworkKey): string {
  const net = NETWORKS[key];
  const byChain = rpcOverrides[String(net.chainId)];
  const byKey = rpcOverrides[key];
  const o = (byChain || byKey || "").trim();
  return o || net.rpcUrl;
}

function viemChain(key: NetworkKey, rpcUrl: string): Chain {
  const n = NETWORKS[key];
  return {
    id: n.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

async function readNative(
  client: ReturnType<typeof createPublicClient>,
  addr: string | null,
  symbol: string,
): Promise<string> {
  if (!addr) return "—";
  try {
    const v = await client.getBalance({ address: addr as `0x${string}` });
    return `${formatEther(v)} ${symbol}`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e))
      .replace(/\s+/g, " ")
      .trim();
    return `error (${msg.slice(0, 48)}${msg.length > 48 ? "…" : ""})`;
  }
}

async function main() {
  const deployer = pickAddr("DEPLOYER_ADDRESS");
  const agent = pickAddr(
    "AGENT_ADDRESS",
    "NEXT_PUBLIC_AGENT_ADDRESS",
    "VITE_AGENT_ADDRESS",
  );

  const keys = Object.keys(NETWORKS) as NetworkKey[];

  console.log("\n  Native balances (all chains in network-definitions)\n");
  if (!deployer && !agent) {
    console.log(
      "  Set DEPLOYER_ADDRESS and/or AGENT_ADDRESS in repo-root .env (see just accounts).\n",
    );
  }

  const rows = await Promise.all(
    keys.map(async (key) => {
      const rpcUrl = rpcForNetwork(key);
      const net = NETWORKS[key];
      const chain = viemChain(key, rpcUrl);
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { timeout: 15_000 }),
      });
      const sym = net.nativeCurrency.symbol;
      const [d, a] = await Promise.all([
        readNative(client, deployer, sym),
        readNative(client, agent, sym),
      ]);
      return { name: net.name, key, d, a };
    }),
  );

  const wName = Math.max(12, ...rows.map((r) => r.name.length));
  const wKey = Math.max(8, ...rows.map((r) => r.key.length));
  const wBal = Math.max(10, ...rows.map((r) => Math.max(r.d.length, r.a.length)));

  console.log(
    `  ${"Network".padEnd(wName)}  ${"Key".padEnd(wKey)}  ${"Deployer".padEnd(wBal)}  Agent`,
  );
  console.log(
    `  ${"-".repeat(wName)}  ${"-".repeat(wKey)}  ${"-".repeat(wBal)}  ${"-".repeat(wBal)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(wName)}  ${r.key.padEnd(wKey)}  ${r.d.padEnd(wBal)}  ${r.a}`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
