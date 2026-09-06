#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, "packages/nextjs");
const SHIP_FILE = join(ROOT, ".vercel-ship");
const VERCEL_DIR = join(PKG_DIR, ".vercel");

function randomSuffix(len = 4) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let name = "";
  let preview = false;
  for (const a of args) {
    if (a.startsWith("name=")) name = a.slice(5).trim();
    else if (a === "--preview" || a === "preview") preview = true;
    else if (a && !a.startsWith("-")) name = a.trim();
  }
  return { name, preview };
}

function vercelBin() {
  const r = spawnSync("npx", ["--yes", "vercel", "--version"], {
    stdio: "pipe",
    shell: true,
    timeout: 30_000,
  });
  if (r.status !== 0) {
    console.error("Could not run vercel CLI. Install with: npm i -g vercel");
    process.exit(1);
  }
  return "npx --yes vercel";
}

function run(cmd, opts = {}) {
  console.log("  >", cmd);
  return execSync(cmd, { stdio: "inherit", shell: true, ...opts });
}

function loadShipName() {
  if (existsSync(SHIP_FILE)) {
    const n = readFileSync(SHIP_FILE, "utf8").trim();
    if (n) return n;
  }
  return "";
}

function saveShipName(name) {
  writeFileSync(SHIP_FILE, name + "\n", "utf8");
}

async function main() {
  const { name: customName, preview } = parseArgs();
  const vcl = vercelBin();
  const isLinked = existsSync(join(VERCEL_DIR, "project.json"));

  let projectName = loadShipName();

  if (!isLinked) {
    if (customName) {
      projectName = customName;
    } else if (!projectName) {
      projectName = "leg-agent" + "-" + randomSuffix();
    }
    saveShipName(projectName);

    console.log("");
    console.log("  Vercel project name: " + projectName);
    console.log("  URL will be:        https://" + projectName + ".vercel.app");
    console.log("");

    try {
      run(vcl + " project add " + projectName);
    } catch {
      console.log("  (project may already exist — continuing)");
    }

    run(vcl + " link --project " + projectName + " --yes", { cwd: PKG_DIR });
  } else {
    if (!projectName) {
      try {
        const pj = JSON.parse(readFileSync(join(VERCEL_DIR, "project.json"), "utf8"));
        projectName = pj.projectId || "(linked)";
      } catch {
        projectName = "(linked)";
      }
    }
    console.log("");
    console.log("  Vercel project: " + projectName);
    console.log("");
  }

  const prodFlag = preview ? "" : " --prod";
  run(vcl + " deploy" + prodFlag + " --yes", { cwd: PKG_DIR });

  console.log("");
  console.log("  Ship complete!");
  if (projectName && !projectName.startsWith("(")) {
    console.log("  https://" + projectName + ".vercel.app");
  }
  console.log("");
}

main().catch((e) => {
  console.error("Ship failed:", e.message || e);
  process.exit(1);
});
