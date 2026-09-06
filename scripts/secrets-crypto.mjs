#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const ALGO = "aes-256-gcm";
const SALT_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

export const SECRET_KEY_NAMES = new Set(["DEPLOYER_PRIVATE_KEY","AGENT_PRIVATE_KEY","SWARM_AGENT_KEYS_JSON","ONECLAW_API_KEY","ONECLAW_AGENT_API_KEY","OPENAI_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","ANTHROPIC_API_KEY","SHROUD_PROVIDER_API_KEY","AMPERSEND_SIGNING_KEY","GRAPH_API_KEY"]);

export function encryptSecretsObject(obj, password) {
  const plaintext = JSON.stringify(obj);
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]);
}

export function decryptSecretsFile(path, password) {
  const data = readFileSync(path);
  if (data.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Invalid file");
  }
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const json =
    decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  return JSON.parse(json);
}

export function saveSecretsFile(path, obj, password) {
  writeFileSync(path, encryptSecretsObject(obj, password), { mode: 0o600 });
}

export function loadPublicEnvFile(envPath) {
  const out = {};
  if (!existsSync(envPath)) return out;
  const raw = readFileSync(envPath, "utf8");
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

export function upsertEnvLine(raw, key, value) {
  const prefix = key + "=";
  const lines = raw.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return prefix + value;
    }
    return line;
  });
  if (!found) out.push(prefix + value);
  return out.join("\n").replace(/\n*$/, "") + "\n";
}

export function promptSecretsPassword(promptText = "Secrets password: ") {
  return new Promise((resolve, reject) => {
    const pre = process.env.SCAFFOLD_ENV_PASSWORD;
    if (pre !== undefined && pre !== "") {
      resolve(pre);
      return;
    }
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "No TTY: set SCAFFOLD_ENV_PASSWORD for non-interactive runs",
        ),
      );
      return;
    }
    process.stdout.write(promptText);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    }
    function onData(ch) {
      const c = ch.toString();
      if (c === "\n" || c === "\r" || c === "\u0004") {
        cleanup();
        process.stdout.write("\n");
        resolve(buf);
      } else if (c === "\u0003") {
        cleanup();
        process.exit(1);
      } else if (c === "\u007f" || c === "\b") {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    }
    process.stdin.on("data", onData);
  });
}
