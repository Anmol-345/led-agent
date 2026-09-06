#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDeployNetwork, getRpcUrl } from "./deploy-networks.mjs";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

const network = parseDeployNetwork(process.argv.slice(2));
const rpcUrl = getRpcUrl(network);
console.log("Deploy network:", network, "RPC:", rpcUrl);

function runForge(args) {
  const r = spawnSync("forge", args, {
    stdio: "inherit",
    cwd: foundry,
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const forgeStd = join(foundry, "lib", "forge-std", "src", "Script.sol");
if (!existsSync(forgeStd)) {
  console.log("Installing forge-std (first run)...");
  runForge(["install", "foundry-rs/forge-std", "--no-git"]);
}
runForge(["build"]);
runForge([
  "script",
  "script/Deploy.s.sol:Deploy",
  "--broadcast",
  "--rpc-url",
  rpcUrl,
]);

const gen = spawnSync(process.execPath, ["scripts/generate-abi-types.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (gen.status !== 0) process.exit(gen.status ?? 1);
