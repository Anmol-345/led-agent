#!/usr/bin/env node
/**
 * Display QR codes for deployer and agent public addresses.
 * Run: just accounts
 *
 * Reads repo-root .env (same as just fund / generate). Does not require secrets password.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { loadPublicEnvFile } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");

function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function loadAgentsJsonRoster() {
  const paths = [
    join(ROOT, "packages/nextjs/public/agents.json"),
    join(ROOT, "packages/vite/public/agents.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const arr = Array.isArray(j) ? j : j.agents;
      if (!Array.isArray(arr)) continue;
      return { path: p, rows: arr };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickAddr(...keys) {
  for (const key of keys) {
    const v = (process.env[key] || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/i.test(v)) return v;
  }
  return null;
}

async function main() {
  mergePublicDotenv();
  const deployer = pickAddr("DEPLOYER_ADDRESS");
  const agent = pickAddr(
    "AGENT_ADDRESS",
    "NEXT_PUBLIC_AGENT_ADDRESS",
    "VITE_AGENT_ADDRESS",
  );

  let qrcode;
  try {
    qrcode = (await import("qrcode-terminal")).default;
  } catch {
    qrcode = null;
  }

  console.log("\n  Monorepo accounts (public addresses)\n");

  if (deployer) {
    console.log("  Deployer (DEPLOYER_ADDRESS)");
    console.log("  " + deployer + "\n");
    if (qrcode) {
      qrcode.generate(deployer, { small: true });
      console.log("");
    }
  } else {
    console.log("  Deployer: not set — run just generate\n");
  }

  if (agent) {
    console.log("  Agent (AGENT_ADDRESS / NEXT_PUBLIC_AGENT_ADDRESS)");
    console.log("  " + agent + "\n");
    if (qrcode) {
      qrcode.generate(agent, { small: true });
      console.log("");
    }
  } else {
    console.log("  Agent: not set\n");
  }

  const roster = loadAgentsJsonRoster();
  if (roster && roster.rows.length > 1) {
    const seen = new Set(
      [deployer, agent]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase()),
    );
    for (const row of roster.rows) {
      const id = row && typeof row.id === "string" ? row.id : "?";
      const addr =
        row && typeof row.address === "string" ? row.address.trim() : "";
      if (!/^0x[a-fA-F0-9]{40}$/i.test(addr)) continue;
      const low = addr.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      console.log("  Swarm agent (" + id + ")");
      console.log("  " + addr + "\n");
      if (qrcode) {
        qrcode.generate(addr, { small: true });
        console.log("");
      }
    }
  }

  if (!qrcode) {
    console.log(
      "  (Install qrcode-terminal at repo root: npm i -D qrcode-terminal)\n",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
