#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  decryptSecretsFile,
  loadPublicEnvFile,
  promptSecretsPassword,
} from "./secrets-crypto.mjs";

const ROOT = process.cwd();
const ENC = join(ROOT, ".env.secrets.encrypted");
const DOTENV = join(ROOT, ".env");

function mergePublicIntoProcess() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "") process.env[k] = v;
  }
}

mergePublicIntoProcess();

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const cmd = split >= 0 ? argv.slice(split + 1) : argv;
if (cmd.length === 0) {
  console.error(
    "Usage: node scripts/with-secrets.mjs -- <command> [args...]",
  );
  process.exit(1);
}

async function main() {
  if (existsSync(ENC)) {
    try {
      const pw = await promptSecretsPassword(
        "Secrets password (.env.secrets.encrypted): ",
      );
      const secrets = decryptSecretsFile(ENC, pw);
      for (const [k, v] of Object.entries(secrets)) {
        if (typeof v === "string" && v !== "") process.env[k] = v;
      }
    } catch {
      console.error(
        "Wrong password or corrupt .env.secrets.encrypted",
      );
      process.exit(1);
    }
  }

  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  child.on("exit", (code, sig) => {
    process.exit(code ?? (sig ? 1 : 0));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
