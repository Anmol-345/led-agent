#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  decryptSecretsFile,
  loadPublicEnvFile,
  promptSecretsPassword,
  saveSecretsFile,
  upsertEnvLine,
} from "./secrets-crypto.mjs";

const ROOT = process.cwd();
const ENV_PATH = join(ROOT, ".env");
const ENC_PATH = join(ROOT, ".env.secrets.encrypted");

async function tryAutoFundDeployer(address) {
  const fundPath = join(ROOT, "scripts", "fund-deployer.mjs");
  if (!existsSync(fundPath)) return;
  if (process.env.SCAFFOLD_SKIP_AUTO_FUND === "1") return;
  try {
    const { fundLocalAddresses } = await import("./fund-deployer.mjs");
    const pub = loadPublicEnvFile(ENV_PATH);
    const rpc =
      process.env.RPC_URL?.trim() ||
      process.env.LOCALHOST_RPC_URL?.trim() ||
      (pub.RPC_URL && String(pub.RPC_URL).trim()) ||
      "http://127.0.0.1:8545";
    const result = await fundLocalAddresses([address], rpc);
    if (result.ok && result.funded.length) {
      console.log(
        "  Auto-funded deployer on local devnet (100 ETH from account #0): " +
          address,
      );
    } else if (!result.ok) {
      console.log(
        "  Auto-fund skipped: " +
          (result.message || "chain unreachable") +
          ". Run just chain then just fund when ready.",
      );
    }
  } catch {
    console.log(
      "  Auto-fund skipped. Run just chain then just fund when ready.",
    );
  }
}

async function main() {
  if (existsSync(ENC_PATH)) {
    const pw = await promptSecretsPassword(
      "Secrets password (to update .env.secrets.encrypted): ",
    );
    let secrets;
    try {
      secrets = decryptSecretsFile(ENC_PATH, pw);
    } catch {
      console.error("Invalid password or corrupt .env.secrets.encrypted");
      process.exit(1);
    }
    if (secrets.DEPLOYER_PRIVATE_KEY) {
      const pub = loadPublicEnvFile(ENV_PATH);
      console.log("\n  Deployer already exists.");
      if (pub.DEPLOYER_ADDRESS) console.log("  Address: " + pub.DEPLOYER_ADDRESS);
      console.log("");
      process.exit(0);
    }
    const { generatePrivateKey, privateKeyToAccount } = await import(
      "viem/accounts"
    );
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    secrets.DEPLOYER_PRIVATE_KEY = privateKey;
    saveSecretsFile(ENC_PATH, secrets, pw);
    let raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
    raw = upsertEnvLine(raw, "DEPLOYER_ADDRESS", account.address);
    writeFileSync(ENV_PATH, raw, { mode: 0o600 });
    console.log("\n  \u2714 Generated deployer wallet");
    console.log("  Address: " + account.address);
    console.log("");
    try {
      const qrcode = await import("qrcode-terminal");
      qrcode.default.generate(account.address, { small: true });
    } catch {
      /* optional */
    }
    await tryAutoFundDeployer(account.address);
    return;
  }

  if (existsSync(ENV_PATH)) {
    const env = readFileSync(ENV_PATH, "utf8");
    if (/DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]+/.test(env)) {
      const match = env.match(/DEPLOYER_ADDRESS=([^\n]+)/);
      console.log("\n  Deployer already exists.");
      if (match) console.log("  Address: " + match[1]);
      console.log("");
      process.exit(0);
    }
  }

  const { generatePrivateKey, privateKeyToAccount } = await import(
    "viem/accounts"
  );
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  let envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (envContent.length > 0 && !envContent.endsWith("\n")) envContent += "\n";
  envContent += "DEPLOYER_PRIVATE_KEY=" + privateKey + "\n";
  envContent += "DEPLOYER_ADDRESS=" + account.address + "\n";
  writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
  console.log("\n  \u2714 Generated deployer wallet");
  console.log("  Address: " + account.address);
  console.log("");
  try {
    const qrcode = await import("qrcode-terminal");
    qrcode.default.generate(account.address, { small: true });
  } catch {
    /* optional */
  }
  await tryAutoFundDeployer(account.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
