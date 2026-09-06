#!/usr/bin/env node
/**
 * Set secrets for the scaffolded repo.
 *
 *   node scripts/secret-add.mjs env <KEY> [VALUE]
 *   node scripts/secret-add.mjs encrypted <KEY> [VALUE]
 *   node scripts/secret-add.mjs vault <path> [VALUE]
 *
 * Value order: CLI arg → SECRET_VALUE env → stdin (pipe) → interactive prompt.
 *
 * env — Upsert repo-root .env (plain). Use for NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 *       (Reown / WalletConnect Cloud). The Next/Vite client reads this from .env at
 *       dev/build time; a 1Claw vault path alone is NOT enough for the browser bundle.
 *
 * encrypted — Merge KEY into .env.secrets.encrypted (AES bundle). Prompts for password.
 *             Creates the file if it does not exist yet.
 *
 * vault — PUT secret at path in 1Claw (needs ONECLAW_API_KEY + ONECLAW_VAULT_ID).
 *         Good for server-side keys (e.g. llm-api-key). Wrap with with-secrets if your
 *         API key lives in the encrypted file:
 *           node scripts/with-secrets.mjs -- node scripts/secret-add.mjs vault my/path value
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
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
const DOTENV = join(ROOT, ".env");
const ENC = join(ROOT, ".env.secrets.encrypted");
const BASE = "https://api.1claw.xyz";

function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function formatPlainEnvValue(v) {
  if (v.includes("\n") || v.includes("\r")) {
    throw new Error("Value cannot contain newlines; use SECRET_VALUE=… or a file + xargs");
  }
  if (/^[A-Za-z0-9._/@:-]+$/.test(v)) return v;
  return (
    '"' +
    v
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$") +
    '"'
  );
}

async function resolveValue(arg) {
  if (arg !== undefined && arg !== "") return arg;
  const fromEnv = (process.env.SECRET_VALUE || "").trim();
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    try {
      return readFileSync(0, "utf8").trim();
    } catch {
      return "";
    }
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Value: ", (a) => {
      rl.close();
      resolve((a || "").trim());
    });
  });
}

async function promptNewPasswordTwice() {
  for (;;) {
    const p1 = await promptSecretsPassword("New secrets password: ");
    const p2 = await promptSecretsPassword("Confirm secrets password: ");
    if (p1 !== p2) {
      console.error("Passwords do not match. Please try again.\n");
      continue;
    }
    if (!p1) {
      throw new Error("Password cannot be empty");
    }
    return p1;
  }
}

async function getToken(apiKey) {
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    throw new Error("1Claw auth failed: " + res.status + " " + (await res.text()));
  }
  const j = await res.json();
  return j.access_token;
}

async function runEnv(key, value) {
  const v = await resolveValue(value);
  if (!v) {
    console.error("Missing value (pass as arg, set SECRET_VALUE, or pipe stdin).");
    process.exit(1);
  }
  let raw = existsSync(DOTENV) ? readFileSync(DOTENV, "utf8") : "";
  raw = upsertEnvLine(raw, key, formatPlainEnvValue(v));
  writeFileSync(DOTENV, raw, "utf8");
  console.log("Updated " + DOTENV + " → " + key + "=(set)");
}

async function runEncrypted(key, value) {
  const v = await resolveValue(value);
  if (!v) {
    console.error("Missing value (pass as arg, set SECRET_VALUE, or pipe stdin).");
    process.exit(1);
  }
  if (existsSync(ENC)) {
    const pw = await promptSecretsPassword("Secrets password (.env.secrets.encrypted): ");
    let obj;
    try {
      obj = decryptSecretsFile(ENC, pw);
    } catch {
      console.error("Wrong password or corrupt .env.secrets.encrypted");
      process.exit(1);
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      console.error("Invalid secrets file shape (expected JSON object).");
      process.exit(1);
    }
    obj[key] = v;
    saveSecretsFile(ENC, obj, pw);
    console.log("Updated " + ENC + " → " + key + "=(set)");
  } else {
    const pw = await promptNewPasswordTwice();
    saveSecretsFile(ENC, { [key]: v }, pw);
    console.log("Created " + ENC + " with " + key + "=(set)");
  }
}

async function runVault(path, value) {
  mergePublicDotenv();
  const v = await resolveValue(value);
  if (!v) {
    console.error("Missing value (pass as arg, set SECRET_VALUE, or pipe stdin).");
    process.exit(1);
  }
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  if (!apiKey) {
    console.error(
      "Missing ONECLAW_API_KEY (add to .env or run via with-secrets.mjs if it is encrypted).",
    );
    process.exit(1);
  }
  if (!vaultId) {
    console.error(
      "Missing ONECLAW_VAULT_ID (set in .env or run just sync-1claw-env after just list-1claw).",
    );
    process.exit(1);
  }
  const token = await getToken(apiKey);
  const encPath = encodeURIComponent(path.replace(/^\/+/, ""));
  const url =
    BASE +
    "/v1/vaults/" +
    encodeURIComponent(vaultId) +
    "/secrets/" +
    encPath;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "generic", value: v }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("1Claw PUT secret failed:", res.status, t);
    process.exit(1);
  }
  console.log("1Claw vault secret set: " + path + " in vault " + vaultId);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const kind = (argv[0] || "").toLowerCase();
  const keyOrPath = argv[1] || "";
  const valueArg = argv.slice(2).join(" ") || undefined;

  if (!kind || (kind !== "env" && kind !== "encrypted" && kind !== "vault")) {
    console.error(
      "Usage:\n" +
        "  node scripts/secret-add.mjs env <KEY> [VALUE]\n" +
        "  node scripts/secret-add.mjs encrypted <KEY> [VALUE]\n" +
        "  node scripts/secret-add.mjs vault <path> [VALUE]\n\n" +
        "VALUE: third+ args, or SECRET_VALUE env, or stdin, or prompt.\n" +
        "WalletConnect / Reown: use env with NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (Next) or\n" +
        "VITE_WALLETCONNECT_PROJECT_ID (Vite), or: just reown <project_id>\n",
    );
    process.exit(1);
  }
  if (!keyOrPath) {
    console.error("Missing key or vault path.");
    process.exit(1);
  }

  if (kind === "env") await runEnv(keyOrPath, valueArg);
  else if (kind === "encrypted") await runEncrypted(keyOrPath, valueArg);
  else await runVault(keyOrPath, valueArg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
