#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
let passed = 0;
let warned = 0;
let failed = 0;

function ok(msg) { passed++; console.log("  \x1b[32m✓\x1b[0m " + msg); }
function warn(msg) { warned++; console.log("  \x1b[33m!\x1b[0m " + msg); }
function fail(msg) { failed++; console.log("  \x1b[31m✗\x1b[0m " + msg); }

function hasCmd(cmd) {
  try { execSync("which " + cmd, { stdio: "ignore" }); return true; }
  catch { return false; }
}

function envVal(key) {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return undefined;
  const m = readFileSync(envPath, "utf8").match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : undefined;
}

console.log("\n\x1b[1m  scaffold-agent doctor\x1b[0m\n");

// ─── Prerequisites ──────────────────────────
console.log("\x1b[36m  Prerequisites\x1b[0m");
hasCmd("node") ? ok("node " + process.version) : fail("node not found");
hasCmd("npm") ? ok("npm available") : fail("npm not found");
hasCmd("forge") ? ok("forge (Foundry) available") : warn("forge not found — run: curl -L https://foundry.paradigm.xyz | bash && foundryup");
hasCmd("anvil") ? ok("anvil available") : warn("anvil not found (part of Foundry)");
hasCmd("just") ? ok("just (task runner) available") : warn("just not found — https://github.com/casey/just#installation");

// ─── Environment ────────────────────────────
console.log("\n\x1b[36m  Environment\x1b[0m");
existsSync(join(ROOT, ".env")) ? ok(".env exists") : warn(".env missing — run scaffold setup or just env");
existsSync(join(ROOT, ".env.secrets.encrypted")) ? ok(".env.secrets.encrypted exists") : warn(".env.secrets.encrypted missing — run just enc to add secrets");

const deployer = envVal("DEPLOYER_ADDRESS");
deployer ? ok("DEPLOYER_ADDRESS = " + deployer.slice(0, 10) + "...") : warn("DEPLOYER_ADDRESS not set in .env");
const agent = envVal("AGENT_ADDRESS");
agent ? ok("AGENT_ADDRESS = " + agent.slice(0, 10) + "...") : warn("AGENT_ADDRESS not set in .env");



// ─── Packages ─────────────────────────────
console.log("\n\x1b[36m  Packages\x1b[0m");
const uiPkg = join(ROOT, "packages/nextjs/node_modules");
existsSync(uiPkg) ? ok("UI dependencies installed") : warn("UI dependencies missing — run: npm install");

const chainPkg = join(ROOT, "packages/foundry/node_modules");
existsSync(chainPkg) ? ok("foundry dependencies installed") : warn("foundry dependencies missing — run: npm install");

// ─── Summary ──────────────────────────────
console.log("");
if (failed > 0) {
  console.log("  \x1b[31m" + failed + " issue(s)\x1b[0m, " + warned + " warning(s), " + passed + " passed");
  process.exit(1);
} else if (warned > 0) {
  console.log("  \x1b[33m" + warned + " warning(s)\x1b[0m, " + passed + " passed — looks good overall");
} else {
  console.log("  \x1b[32mAll " + passed + " checks passed — ready to build!\x1b[0m");
}
console.log("");
