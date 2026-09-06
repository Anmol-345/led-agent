#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";
import {
  decryptSecretsFile,
  loadPublicEnvFile,
  promptSecretsPassword,
  saveSecretsFile,
  upsertEnvLine,
} from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, ".env");
const ENC_PATH = join(ROOT, ".env.secrets.encrypted");

function findAgentsJsonPath() {
  const nextP = join(ROOT, "packages/nextjs/public/agents.json");
  const viteP = join(ROOT, "packages/vite/public/agents.json");
  if (existsSync(nextP)) return nextP;
  if (existsSync(viteP)) return viteP;
  if (existsSync(join(ROOT, "packages/nextjs"))) return nextP;
  return viteP;
}

function parseExtraSwarmKeys(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function nextAgentId(roster) {
  let max = 0;
  for (const row of roster) {
    const id = row && typeof row.id === "string" ? row.id : "";
    const m = /^agent-(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
    else if (id) max = Math.max(max, 1);
  }
  return "agent-" + (max + 1);
}

async function main() {
  const argv = process.argv.slice(2).filter((x) => x !== "--");
  let add = 1;
  for (const a of argv) {
    const m = /^agents=(\d+)$/.exec(a) || /^--agents=(\d+)$/.exec(a);
    if (m) {
      add = parseInt(m[1], 10);
      continue;
    }
    if (/^\d+$/.test(a)) add = parseInt(a, 10);
  }
  if (!Number.isFinite(add) || add < 1 || add > 64) {
    console.error("Usage: node scripts/swarm-agents.mjs [N] or agents=N (1–64)");
    process.exit(1);
  }

  const pub = loadPublicEnvFile(ENV_PATH);
  for (const [k, v] of Object.entries(pub)) {
    if (v && process.env[k] === undefined) process.env[k] = v;
  }

  const primaryAddr = (process.env.AGENT_ADDRESS || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/i.test(primaryAddr)) {
    console.error(
      "AGENT_ADDRESS missing in .env — generate an agent wallet first (scaffold with --agent generate).",
    );
    process.exit(1);
  }

  const agentsPath = findAgentsJsonPath();
  const agentsDir = dirname(agentsPath);
  if (!existsSync(agentsDir)) {
    console.error("No packages/nextjs or packages/vite public folder found.");
    process.exit(1);
  }

  let roster = [];
  if (existsSync(agentsPath)) {
    try {
      const j = JSON.parse(readFileSync(agentsPath, "utf8"));
      roster = Array.isArray(j) ? j : [];
    } catch {
      roster = [];
    }
  }
  if (roster.length === 0) {
    roster = [{ id: "agent", address: primaryAddr }];
  }

  const { generatePrivateKey, privateKeyToAccount } = await import(
    "viem/accounts"
  );

  let extras = [];
  let plainEnvRaw = "";

  if (existsSync(ENC_PATH)) {
    const pw = await promptSecretsPassword(
      "Secrets password (update swarm keys): ",
    );
    let secrets;
    try {
      secrets = decryptSecretsFile(ENC_PATH, pw);
    } catch {
      console.error("Invalid password or corrupt .env.secrets.encrypted");
      process.exit(1);
    }
    extras = parseExtraSwarmKeys(secrets.SWARM_AGENT_KEYS_JSON);
    const primaryPk = (secrets.AGENT_PRIVATE_KEY || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/i.test(primaryPk)) {
      console.error("AGENT_PRIVATE_KEY missing in encrypted secrets.");
      process.exit(1);
    }
    for (let i = 0; i < add; i++) {
      const pk = generatePrivateKey();
      const acct = privateKeyToAccount(pk);
      const id = nextAgentId(roster);
      extras.push({ id, privateKey: pk });
      roster.push({
        id,
        address: acct.address,
      });
    }
    secrets.SWARM_AGENT_KEYS_JSON = JSON.stringify(extras);
    saveSecretsFile(ENC_PATH, secrets, pw);
  } else {
    plainEnvRaw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
    const agentPk = (process.env.AGENT_PRIVATE_KEY || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/i.test(agentPk)) {
      console.error(
        "AGENT_PRIVATE_KEY missing in .env — cannot extend swarm in plain-secrets mode.",
      );
      process.exit(1);
    }
    const pkMatch = plainEnvRaw.match(/SWARM_AGENT_KEYS_JSON=(.+)/);
    let current = "[]";
    if (pkMatch) {
      let v = pkMatch[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      current = v;
    }
    extras = parseExtraSwarmKeys(current);
    for (let i = 0; i < add; i++) {
      const pk = generatePrivateKey();
      const acct = privateKeyToAccount(pk);
      const id = nextAgentId(roster);
      extras.push({ id, privateKey: pk });
      roster.push({
        id,
        address: acct.address,
      });
    }
    const json = JSON.stringify(extras);
    plainEnvRaw = upsertEnvLine(plainEnvRaw, "SWARM_AGENT_KEYS_JSON", json);
    writeFileSync(ENV_PATH, plainEnvRaw, { mode: 0o600 });
  }

  writeFileSync(agentsPath, JSON.stringify(roster, null, 2) + "\n", {
    mode: 0o644,
  });

  console.log("\n  Added " + add + " swarm agent(s). Updated:\n");
  console.log("   " + agentsPath);
  console.log("   SWARM_AGENT_KEYS_JSON (secrets)\n");
  console.log("  Run just fund (with chain up) to fund new addresses.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
