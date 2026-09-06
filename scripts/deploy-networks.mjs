/**
 * Shared deploy/verify network resolution (used by deploy-foundry, deploy-hardhat, verify-*).
 * Override RPC for public chains with RPC_URL in .env.
 */
const DEFAULT_RPC = {
  localhost: "http://127.0.0.1:8545",
  // rpc.sepolia.org now returns 404; publicnode is the working public endpoint.
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  baseSepolia: "https://sepolia.base.org",
  ethereum: "https://eth.llamarpc.com",
  mainnet: "https://eth.llamarpc.com",
  polygon: "https://polygon-rpc.com",
  bnb: "https://bsc-dataseed.binance.org",
  bsc: "https://bsc-dataseed.binance.org",
  botchain: "https://rpc.botchain.ai",
  botchainTestnet: "https://rpc.bohr.life",
};

const CHAIN_IDS = {
  localhost: 31337,
  sepolia: 11155111,
  base: 8453,
  baseSepolia: 84532,
  ethereum: 1,
  mainnet: 1,
  polygon: 137,
  bnb: 56,
  bsc: 56,
  botchain: 677,
  botchainTestnet: 968,
};

/** `forge verify-contract --chain <x>` */
const FORGE_CHAIN = {
  localhost: "31337",
  sepolia: "sepolia",
  base: "base",
  baseSepolia: "base-sepolia",
  ethereum: "mainnet",
  mainnet: "mainnet",
  polygon: "polygon",
  bnb: "bsc",
  bsc: "bsc",
  botchain: "677",
  botchainTestnet: "968",
};

const ALIASES = {
  local: "localhost",
  anvil: "localhost",
  "31337": "localhost",
  eth: "ethereum",
  matic: "polygon",
  base_sepolia: "baseSepolia",
  "base-sepolia": "baseSepolia",
  basesepolia: "baseSepolia",
  "botchain-testnet": "botchainTestnet",
  botchain_testnet: "botchainTestnet",
  bohr: "botchainTestnet",
  "677": "botchain",
  "968": "botchainTestnet",
};

export function normalizeNetwork(name) {
  const raw = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  const compact = raw.replace(/-/g, "");
  const n = compact === "basesepolia" ? "baseSepolia" : raw;
  const k = ALIASES[n] || ALIASES[compact] || n;
  if (!DEFAULT_RPC[k]) {
    throw new Error(
      'Unknown network "' +
        name +
        '". Use: localhost, sepolia, base, baseSepolia, ethereum, polygon, bnb, botchain, botchainTestnet',
    );
  }
  return k === "mainnet" ? "ethereum" : k;
}

function scanArgvForNetwork(argv, initial) {
  let network = initial;
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--network" || a === "-n") {
      network = args[i + 1];
      if (!network) throw new Error("--network requires a value (e.g. base)");
      i++;
      continue;
    }
    if (a.startsWith("--network=")) {
      network = a.slice("--network=".length);
      continue;
    }
    if (!a.startsWith("-") && (network === null || network === undefined || network === "")) {
      network = a;
    }
  }
  return network;
}

/** deploy-foundry / deploy-hardhat (CLI / --network overrides DEPLOY_NETWORK) */
export function parseDeployNetwork(argv) {
  let network = scanArgvForNetwork(argv, null);
  if (!(network || "").trim()) network = (process.env.DEPLOY_NETWORK || "").trim();
  const resolved = (network || "localhost").trim();
  return normalizeNetwork(resolved);
}

/** verify-* ; argv / VERIFY_NETWORK, else default sepolia */
export function parseVerifyNetwork(argv) {
  let network = scanArgvForNetwork(argv, null);
  if (!(network || "").trim()) network = (process.env.VERIFY_NETWORK || "").trim();
  let resolved = (network || "").trim();
  if (!resolved) {
    resolved = "sepolia";
    console.error(
      "verify: no network specified — using sepolia (try: just verify base)",
    );
  }
  return normalizeNetwork(resolved);
}

export function getRpcUrl(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "localhost") return DEFAULT_RPC.localhost;
  const fromEnv = (process.env.RPC_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (k === "botchain") {
    return (process.env.BOTCHAIN_RPC || "").trim() || DEFAULT_RPC.botchain;
  }
  if (k === "botchainTestnet") {
    return (process.env.BOTCHAIN_TESTNET_RPC || "").trim() || DEFAULT_RPC.botchainTestnet;
  }
  return DEFAULT_RPC[k];
}

export function getChainId(networkKey) {
  return CHAIN_IDS[normalizeNetwork(networkKey)];
}

export function getForgeChain(networkKey) {
  return FORGE_CHAIN[normalizeNetwork(networkKey)];
}

export function isLocalNetwork(networkKey) {
  return normalizeNetwork(networkKey) === "localhost";
}

/** Hardhat `--network` name (ethereum mainnet → `mainnet`) */
export function getHardhatNetworkName(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "ethereum") return "mainnet";
  return k;
}

/** Which API key env var to prefer for block explorer verification */
export function getExplorerKeyEnv(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "base" || k === "baseSepolia") return "BASESCAN_API_KEY";
  if (k === "polygon") return "POLYGONSCAN_API_KEY";
  if (k === "bnb") return "BSCSCAN_API_KEY";
  return "ETHERSCAN_API_KEY";
}

export function getExplorerApiKey(networkKey) {
  const primary = getExplorerKeyEnv(networkKey);
  const k = normalizeNetwork(networkKey);
  const v =
    (process.env[primary] || "").trim() ||
    (process.env.ETHERSCAN_API_KEY || "").trim();
  if (!v) {
    throw new Error(
      "Set " +
        primary +
        " or ETHERSCAN_API_KEY in .env to verify on " +
        k,
    );
  }
  return v;
}
