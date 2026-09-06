/**
 * Register an ERC-8004 agent on-chain using AGENT_PRIVATE_KEY (pays gas).
 * Run: just register-agent
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { getActiveNetwork } from "../network-definitions";

const ROOT = process.cwd();
const PKG = join(ROOT, "package.json");

function readProjectName(): string {
  if (!existsSync(PKG)) return "leg-agent";
  try {
    const j = JSON.parse(readFileSync(PKG, "utf8")) as { name?: string };
    return typeof j.name === "string" && j.name ? j.name : "leg-agent";
  } catch {
    return "leg-agent";
  }
}

async function main() {
  const pk = (process.env.AGENT_PRIVATE_KEY || "").trim();
  const agentAddr = (process.env.AGENT_ADDRESS || "").trim();
  if (!pk) {
    console.error("Missing AGENT_PRIVATE_KEY (set in .env or .env.secrets.encrypted via with-secrets).");
    process.exit(1);
  }
  const net = getActiveNetwork();
  const name = readProjectName();
  const title = "leg-agent agent";
  const description = "Onchain AI agent scaffolded with leg-agent. ERC-8004 registration via Agent0.";

  const { SDK } = await import("agent0-sdk");
  const sdk = new SDK({
    chainId: net.chainId,
    rpcUrl: net.rpcUrl,
    privateKey: (pk.startsWith("0x") ? pk : "0x" + pk) as `0x${string}`,
  });

  console.log("Network:", net.name, "chainId:", net.chainId);
  console.log("RPC:", net.rpcUrl);

  const agent = sdk.createAgent(title, description, "");
  if (agentAddr && /^0x[a-fA-F0-9]{40}$/i.test(agentAddr)) {
    agent.setWallet(agentAddr as `0x${string}`);
    console.log("Operational wallet set to AGENT_ADDRESS:", agentAddr);
  }
  agent.setActive(true);

  console.log("Submitting registerOnChain()…");
  const tx = await agent.registerOnChain();
  console.log("Tx submitted:", (tx as { txHash?: string }).txHash ?? tx);
  await tx.waitConfirmed({ timeoutMs: 300_000 });
  console.log("Confirmed.");
  const id = (agent as { agentId?: string }).agentId;
  if (id !== undefined && id !== null) console.log("Agent ID:", id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
